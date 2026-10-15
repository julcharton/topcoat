Topcoat's runtime adds browser interactions to server-rendered pages. Write state and expressions in Rust alongside your markup. The runtime compiles the browser code to JavaScript and includes it with the page.

The runtime is **highly experimental**. Expressions support a limited set of Rust types and operations, and the API may change.

Use [`link`](struct.link.html) for navigation without a full document reload, with prefetching and support for custom anchors.

# Setup

Interactive pages need the runtime's browser script. `script()` renders the script tag; include it in your document head:

```rust
# use topcoat::{Result, view::*};
# #[component]
# async fn document() -> Result<impl View> {
Ok(view! {
    <html>
        <head>
            topcoat::runtime::script()
        </head>
        <body></body>
    </html>
})
# }
```

Call [`runtime()`](RouterBuilderRuntimeExt::runtime) to enable page reruns, and load the [asset bundle](../asset/index.html) to serve the browser script. Register your application layers before calling `.runtime()`:

```rust,no_run
use topcoat::{
    asset::{AssetBundle, RouterBuilderAssetExt},
    router::{Router, RouterBuilderDiscoverExt, module_router},
    runtime::RouterBuilderRuntimeExt,
};

pub fn router() -> Router {
    module_router!()
        .discover()
        .assets(AssetBundle::load().unwrap())
        .runtime()
        .build()
}
```

The runtime reruns a page by sending its current signal values to the page's URL. The [`RuntimeLayer`] added by `.runtime()` converts this request into a `GET`, so the page and its layouts can render with those values. Registering your layers first lets them handle the rerun as a `GET`. See [`RuntimeLayer`] for the request format and rewrite behavior.

`module_router!()` registers pages from the module tree. `.discover()` adds [procedures](#procedures) and [shards](#shards) from your application. To register a procedure or shard explicitly, pass its name to `.route()`.

# Runtime expressions

A `$(...)` block is a **runtime expression**. Use it in a view to render its value:

```rust
# use topcoat::{Result, view::*};
# #[component]
# async fn example() -> Result<impl View> {
Ok(view! {
    <p>"The answer: " $(1 + 2)</p>
})
# }
```

The server evaluates the expression for the initial HTML. Expressions that need browser updates also compile to JavaScript and can run again without a server request.

Runtime expressions support a subset of Rust with matching behavior in both languages. See [`expr!`] for supported operations, captured values, and embedding JavaScript with `raw!`.

The expression `1 + 2` is static. To make an expression update, have it read a signal.

# Signals

A **signal** holds state for the browser. Create one with [`signal`], passing the request context and a closure for its initial value. Read it in a runtime expression with `.get()`:

```rust
# use topcoat::{Result, context::Cx, runtime::signal, view::*};
# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
let count = signal(cx, || 0usize);

Ok(view! {
    <p>"Count: " $(count.get())</p>
})
# }
```

The server computes the initial value and sends it to the browser. **Values sent back by the browser are user input and must be validated.**

A signal is cheap to clone. Runtime expressions can share it, and components can accept it as a `&Signal<T>` parameter.

In the browser, an expression runs again whenever a signal it reads changes. `.get()` reads the current value and `.set(...)` replaces it. Use an event handler to change `count` when the user clicks a button.

## Browser write checkpoints

Inside a browser expression, `signal.write_revision()` returns a `u64` counting committed writes to that signal's handle. Use it to check whether a write happened after a saved checkpoint, even if the value is equal or changed from A to B and back to A. The count starts at zero and advances for every successful write, including writes through mutation helpers and references.

```rust
# use topcoat::{Result, context::Cx, runtime::signal, view::*};
# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
let open = signal(cx, || false);
let written = signal(cx, || false);

Ok(view! {
    <button @click=$(|_e| {
        let checkpoint = open.write_revision();
        open.set(false);
        written.set(open.write_revision() != checkpoint);
    })>"Check a write"</button>
    <p>"Written: " $(written.get())</p>
})
# }
```

Reading the revision in a browser effect subscribes that effect to writes, separately from ordinary value changes. Existing untracked execution stays untracked. Effects remain batched, so they may observe only the latest revision. Reading a revision does not run effects or user callbacks. Writes during an effect still notify other subscribers without scheduling that effect again.

Revisions belong to the browser handle. Aliases share them, and declaration adoption preserves them when content is replaced. Hydration, reads, and serialization do not advance them. Removing a signal and later recreating its declaration starts a fresh lifetime at zero. Compare checkpoints only within the same handle's lifetime; equal numbers from different handles do not imply shared history.

A failed updater does not commit a write. Its side effects are not rolled back, including successful nested writes. Commits are counted after their updater returns. Once the count reaches `u64::MAX`, the next commit fails without changing the value or revision. Updater side effects can still occur before this check.

`write_revision()` is browser-only and panics during server evaluation. Use it in browser-executed code, such as an event-handler body, rather than an expression that the server evaluates for initial HTML. The runtime does not include the counter as metadata in signal declarations, captures, or server requests. The returned `u64` is an ordinary value that you can deliberately store in a signal or submit to the server. Such a value cannot seed or restore a browser handle's counter. See [`SignalSurrogate::write_revision`](struct.SignalSurrogate.html#method.write_revision).

# Event handlers

An attribute starting with `@` attaches a DOM event handler, such as `@click`. Its value is a runtime expression returning a closure. The browser calls that closure when the event fires:

```rust
# use topcoat::{Result, context::Cx, runtime::signal, view::*};
# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
let count = signal(cx, || 0usize);

Ok(view! {
    <button @click=$(|_e| count.set(count.get() + 1))>"+1"</button>
    <p>"Count: " $(count.get())</p>
})
# }
```

Clicking the button runs the closure, the closure updates the signal, and the `$(count.get())` text re-renders. The entire loop happens in the browser.

The closure receives an [`Event`] with access to the DOM event's data and methods. For example, an input handler can copy the element's value into a signal:

```rust
# use topcoat::{Result, context::Cx, runtime::{Event, signal}, view::*};
# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
let query = signal(cx, String::new);

Ok(view! {
    <input @input=$(|e: Event| query.set(e.target.value))>
})
# }
```

For operations outside the expression vocabulary, use a JavaScript string literal, such as `@click="alert('hi')"`.

`e.related_target` is an option containing the browser's related event target. For focus entering an element, it refers to the target losing focus. For focus leaving an element, it refers to the target gaining focus. It is `None` when the native target is null or the event has no related target. A present target need not be an element, and the browser can withhold it, for example when focus crosses a security boundary.

`e.old_state` and `e.new_state` are optional strings from a `ToggleEvent`, including native `beforetoggle` and `toggle` events. Native opening goes from `"closed"` to `"open"`; closing goes from `"open"` to `"closed"`. Events without these properties return `None`. Synthetic toggle events preserve their supplied strings, including `Some("")` for the constructor's empty default.

```rust
# use topcoat::{Result, context::Cx, runtime::{Event, signal}, view::*};
# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
let destination = signal(cx, String::new);
let open = signal(cx, || false);

Ok(view! {
    <input @focusout=$(|e: Event| {
        if e.related_target.is_some() {
            destination.set(e.related_target.unwrap().id);
        } else {
            destination.set("".to_owned());
        }
    })>
    <div popover="auto" @toggle=$(|e: Event| {
        if e.new_state.is_some() {
            open.set(e.new_state.unwrap() == "open");
        }
    })>"Popover content"</div>
})
# }
```

Read event handles and call event methods synchronously, before returning or awaiting. They wrap the live native event, so `current_target` only refers to the listener's target during dispatch, and target properties can change. Copy strings or other ordinary values before asynchronous work. `Event` and `EventTarget` are browser-local handles and cannot be serialized into signals or procedure arguments. Existing `e.key` and `e.is_composing` support keyboard and composition handling.

Signals also have methods for common updates. For example, `$(|_e| count.increment())` adds one to a numeric signal.

# Element references

An [`ElementRef`] identifies an HTML element by its stable ID and expected native type. Create the ID with [`element_id`](../view/fn.element_id.html), then put it on the element:

```rust
# use topcoat::{Result, context::Cx, view::*};
use topcoat::runtime::{ElementRef, InputElement, signal};

# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
let input = ElementRef::<InputElement>::new(element_id(cx));
let status = signal(cx, String::new);

Ok(view! {
    <input id=(input.id())>
    <button @click=$(|_e| {
        let result = input.resolve();
        if result.is_ok() {
            status.set("Input found".to_owned());
        } else {
            let error = result.unwrap_err();
            status.set(if error.is_missing() {
                "Input removed".to_owned()
            } else {
                "Wrong element type".to_owned()
            });
        }
    })>"Check input"</button>
    <p>$(status.get())</p>
})
# }
```

Use [`HtmlElement`] for any HTML element, [`InputElement`] for an input, [`SelectElement`] for a select, [`TextAreaElement`] for a textarea, and [`DialogElement`] for a dialog. `resolve()` looks up the current document each time. It returns a typed handle on success and an [`ElementRefError`] when the ID is missing or the element has the wrong type. The error exposes `is_missing()` and `is_wrong_type()` inside expressions.

Resolve inside a browser event-handler closure. Evaluating resolution on the server panics. A reference captures only its ID and type. Resolved handles cannot be captured, stored in signals, or sent in requests. Resolve again after an `await` or a DOM update, since a previously resolved handle still refers to the node that call found. DOM changes do not trigger reactive evaluation.

IDs must be unique in the document. Follow the [`element_id`](../view/fn.element_id.html) identity rules for keyed components and helpers. References use those same IDs across shard rerenders, live updates, and navigation. Removing an element makes the next resolution fail; inserting a matching replacement makes it resolve to the replacement. References do not keep removed nodes alive. Lookup covers the current document, not shadow roots or other frames.

# Browser actions

Resolved handles expose native browser operations inside `expr!` handlers. Focus accepts a `prevent_scroll` boolean. Scroll options use typed alignment and behavior values, constructed outside the expression:

```rust
# use topcoat::{Result, context::Cx, view::*};
use topcoat::runtime::{
    ElementRef, InputElement, ScrollAlignment, ScrollBehavior, ScrollIntoViewOptions,
};

# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
let input = ElementRef::<InputElement>::new(element_id(cx));
let scroll = ScrollIntoViewOptions {
    block: ScrollAlignment::Center,
    inline: ScrollAlignment::Nearest,
    behavior: ScrollBehavior::Smooth,
};

Ok(view! {
    <input id=(input.id())>
    <button @click=$(|_e| {
        let result = input.resolve();
        if result.is_ok() {
            let element = result.unwrap();
            element.scroll_into_view(scroll).unwrap();
            element.focus(true).unwrap();
        }
    })>"Reveal input"</button>
})
# }
```

`focus(true)` prevents focus from scrolling. Its `Ok(bool)` reports whether the element is active immediately after the call. Disabled, inert, or unfocusable elements can return `Ok(false)`. Scrolling returns `Ok(())` when the native request is accepted. Hidden elements may not scroll, and smooth scrolling completes later. `ScrollAlignment` supports `Start`, `Center`, `End`, and `Nearest` independently for block and inline axes. `ScrollBehavior` supports `Auto` (follow CSS), `Instant`, and `Smooth`. The default options are block start, inline nearest, and auto.

## Containment and form validity

Every HTML handle supports `contains(event.target)`, which returns `Ok(true)` for the element itself or a DOM descendant. Null and non-Node targets return `Ok(false)`. Containment follows the DOM tree, not the composed event path across shadow roots. With an optional related target, check for presence before unwrapping it; absence means the focus moved outside.

Inputs, selects, and textareas support `set_custom_validity(message)` and `report_validity()`. An empty message clears the custom error. Reporting returns the native validity boolean and allows the browser to display validation UI. Canceling the `invalid` event suppresses that UI but does not change the returned validity. Disabled and other controls barred from constraint validation retain their native behavior.

```rust
# use topcoat::{Result, context::Cx, view::*};
use topcoat::runtime::{ElementRef, Event, InputElement};

# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
let input = ElementRef::<InputElement>::new(element_id(cx));
Ok(view! {
    <input id=(input.id()) required="" @input=$(|_e: Event| {
        input.resolve().unwrap().set_custom_validity("").unwrap();
    })>
    <button @click=$(|_e| {
        let element = input.resolve().unwrap();
        element.set_custom_validity("Choose an available name").unwrap();
        element.report_validity().unwrap();
    })>"Check name"</button>
})
# }
```

A control's `form_target()` returns `Result<Option<EventTarget>, BrowserActionError>`. It uses the current native form owner, including an external form named by the `form` attribute. The target can be passed to a scoped listener API to observe `reset`. An unowned control returns `Ok(None)`. The target is a snapshot, cannot be serialized, and does not install a listener itself.

## Popovers and modal dialogs

Use declarative `popover` and `popovertarget` attributes for native popover buttons. When a handler needs to open or close a popover, call `show_popover()` or `hide_popover()` on its HTML handle. Both return the resulting open state. Canceling the native opening `beforetoggle` event can make `show_popover()` return `Ok(false)`. Already open or already closed is a successful no-op. Native toggle events, auto-popover grouping, and light dismissal remain in effect.

A dialog handle supports `show_modal()` and `close(return_value)`. Showing returns whether the dialog is open afterward. Closing returns `Ok(())` and preserves native focus restoration and `close` events. Calling `close` does not dispatch `cancel`; a native Escape request does. An already modal dialog can be shown again. An already closed dialog ignores `close` and keeps its return value.

```rust
# use topcoat::{Result, context::Cx, view::*};
use topcoat::runtime::{DialogElement, ElementRef, HtmlElement};

# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
let popover = ElementRef::<HtmlElement>::new(element_id(cx));
let dialog = ElementRef::<DialogElement>::new(element_id(cx));
Ok(view! {
    <button popovertarget=(popover.id())>"More"</button>
    <div id=(popover.id()) popover="auto">
        <button @click=$(|_e| {
            popover.resolve().unwrap().hide_popover().unwrap();
            dialog.resolve().unwrap().show_modal().unwrap();
        })>"Open dialog"</button>
    </div>
    <dialog id=(dialog.id())>
        <p>"Native modal content"</p>
        <button autofocus="" @click=$(|_e| {
            dialog.resolve().unwrap().close("done").unwrap();
        })>"Close"</button>
    </dialog>
})
# }
```

## Failure handling

Actions return `Result<_, BrowserActionError>` inside expressions. Inspect the error with `is_disconnected()`, `is_unsupported()`, or `is_invalid_state()`. A disconnected handle is rejected before a native operation, and removal during a synchronous native event is also reported as disconnected. Resolve again to act on a replacement. Missing IDs and wrong native types remain `ElementRefError` outcomes from `resolve()`.

An unavailable native method reports unsupported. Invalid native state includes a missing `popover` attribute, an already non-modal open dialog, or a dialog currently shown as a popover. Native cancellation is a normal outcome, not an error. Unexpected JavaScript exceptions propagate. These APIs use native browser behavior without a polyfill. Calling them during server evaluation is rejected. Resolved handles, action errors, and event targets cannot be captured or sent through signals or requests.

Operations are restricted to the appropriate handle type:

```compile_fail
use topcoat::runtime::{ElementRef, HtmlElement, expr};
let element = ElementRef::<HtmlElement>::new("field");
let _ = expr!(|| element.resolve().unwrap().set_custom_validity("Invalid"));
```

```compile_fail
use topcoat::runtime::{ElementRef, InputElement, expr};
let element = ElementRef::<InputElement>::new("field");
let _ = expr!(|| element.resolve().unwrap().show_modal());
```

Form targets cannot be captured:

```compile_fail
use topcoat::runtime::{EventTarget, expr};
fn capture(target: EventTarget) {
    let _ = expr!(target);
}
```

# Bind attributes

An attribute starting with `:` is a **bind attribute**. The server renders its expression's initial value. The browser updates the attribute whenever a signal read by the expression changes:

```rust
# use topcoat::{Result, context::Cx, runtime::signal, view::*};
# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
let open = signal(cx, || false);

Ok(view! {
    <button @click=$(|_e| open.set(!open.get()))>"What is Topcoat?"</button>
    <p :hidden=$(!open.get())>"A fullstack Rust framework."</p>
})
# }
```

Combine `:value` and `@input` to keep an input and signal in sync. The binding displays the signal's value, and the handler writes user edits back to it:

```rust
# use topcoat::{Result, context::Cx, runtime::{Event, signal}, view::*};
# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
let name = signal(cx, String::new);

Ok(view! {
    <input
        :value=$(name.get())
        @input=$(|e: Event| name.set(e.target.value))
    >

    <p>"Hello, " $(name.get()) "!"</p>
})
# }
```

A plain `value` attribute sets an input's default value. If the user types into the input, their text stays in place when the page or shard renders again. If they have not edited the input, it takes the new default value.

Using `:value` has the same effect if its expression does not read any signals. To set the input's current value every time it renders, call [`Expr::dynamic`] on the expression. This works even without a signal. For example, this input is cleared each time it renders:

```rust
# use topcoat::{Result, context::Cx, runtime::Expr, view::*};
# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
// Every render clears what the user typed.
let draft = Expr::from(String::new()).dynamic();

Ok(view! {
    <input :value=(draft)>
})
# }
```

# Scoped effects

Use [`effect`] to attach browser behavior to an element. Pass a compiled synchronous closure and spread the result into the element's attributes. The callback runs after hydration has scanned the inserted DOM and installed its signal watchers. Its body never runs on the server.

```rust
use topcoat::{
    Result, context::Cx,
    runtime::{EffectContext, Event, effect, expr, signal},
    view::{View, component, view},
};

#[component]
async fn editor(cx: &Cx) -> Result<impl View> {
    let edited = signal(cx, || false);
    let reset = effect(expr!(|scope: EffectContext| {
        scope.listen(scope.target(), "reset", |_event: Event| edited.set(false));
    }));
    Ok(view! {
        <form (reset)>
            <input @input=$(|_event| edited.set(true))>
            <button type="reset">"Reset"</button>
            <output>$(if edited.get() { "Edited" } else { "Unchanged" })</output>
        </form>
    })
}
```

The effect tracks signal reads during its synchronous callback and runs again when those signals change. Reads inside listeners or cleanup callbacks are not effect dependencies. Attach one effect per element. Combine related setup in that callback, or attach independent effects to different elements. Attribute collections support forwarding effects to components.

Each invocation receives a fresh [`EffectContext`]. `on_cleanup` registers callbacks that run once, in reverse registration order, before the next invocation or when the owning content is released. `listen(target, event_name, callback)` owns a listener on an [`EventTarget`], including targets outside the attached element's subtree. `target()` returns the attached element. The callback receives the same [`Event`] facade as an `@event` handler. Listener and cleanup callbacks must be synchronous.

Page, shard, live-region, navigation, and dev replacements release old invocations before updating the DOM, even when morphing reuses an element. New attachments initialize after hydration. Replacing a nested region releases effects attached inside it; effects attached to enclosing content stay active. Removing content releases its effects, cancels queued effect runs, and removes owned listeners. A cleanup error is reported without preventing other resources from being released. Cleanup does not depend on observing DOM attributes. Removing nodes directly from external JavaScript does not release a Topcoat scope; let Topcoat own its rendered content.

An effect's first run is queued on the runtime's effect queue. This makes the inserted DOM and its bindings available, but does not wait for a pending server request, later streaming replacement, layout, or paint. Use `is_active()` before applying deferred results. It becomes false before cleanup begins. Signal reads after an asynchronous boundary do not subscribe the effect.

## Raw resource integrations

For browser APIs outside the Rust expression vocabulary, `raw!` receives the same owned context. Its `element` property is the attached DOM element and `abortSignal` is aborted before cleanup. Pass the signal to native listeners or requests. Register observer disconnection and other releases with `on_cleanup`. Registering cleanup after disposal runs it immediately.

```rust
# use topcoat::{Result, runtime::{EffectContext, effect, expr}, view::*};
# #[component]
# async fn measured() -> Result<impl View> {
let measure = effect(expr!(|scope: EffectContext| {
    raw!("(() => {
        const observer = new ResizeObserver(entries => {
            if (!${scope}.abortSignal.aborted) {
                ${scope}.element.style.setProperty('--width', entries[0].contentRect.width + 'px');
            }
        });
        ${scope}.on_cleanup(() => observer.disconnect());
        observer.observe(${scope}.element);
    })()");
}));
# Ok(view! { <section (measure)>"Measured content"</section> })
# }
```

Raw integrations must cancel their queued work or check `abortSignal.aborted` before applying results. The context owns only registered resources. It does not cancel arbitrary promises or browser callbacks automatically.

# DOM scheduling

Use `scope.after_dom(callback)` inside an effect or an owned listener when work needs the current local bindings to settle. The callback runs once without tracking its signal reads. Read the signals that should trigger the effect before queuing the callback. Each call queues separate work, including when no binding needs updating.

```rust
use topcoat::{
    Result, context::Cx,
    runtime::{EffectContext, effect, expr, signal},
    view::{View, component, view},
};

#[component]
async fn filtered_option(cx: &Cx) -> Result<impl View> {
    let visible = signal(cx, || false);
    let scroll = effect(expr!(|scope: EffectContext| {
        if visible.get() {
            let target = scope.clone();
            scope.after_dom(|| {
                raw!("${target}.element.scrollIntoView({ block: 'nearest' })");
            });
        }
    }));
    Ok(view! {
        <button @click=$(|_event| visible.set(true))>"Show option"</button>
        <button :hidden=$(!visible.get()) (scroll)>"Option"</button>
    })
}
```

The runtime drains local bindings and effects, including cascading writes, before invoking a scheduled callback. If that callback writes signals, their updates settle before the next callback. Callbacks run in registration order and may queue further work on the same queue. They do not wait for callbacks registered after them. Rerunning or disposing the owning invocation cancels its pending callbacks, and a disconnected element is skipped. A callback error is reported without blocking other callbacks or future updates. The callback does not wait for server requests, later stream frames, layout, or paint. It can read layout through native browser APIs if needed.

## After server content arrives

Use [`after_render`] for work attached to particular server-rendered content. Spread it into an element returned by the shard or live emission that needs the work. The callback runs once after that insertion is hydrated and local bindings and effects settle. It also runs on initial hydration. Signal reads in this hook do not make it reactive. An element can carry one `effect` and one `after_render` hook.

```rust
use topcoat::{
    Result, context::Cx,
    runtime::{EffectContext, Signal, after_render, expr, shard, signal},
    view::{View, component, view},
};

#[shard]
async fn month_grid(requested: Signal<usize>) -> Result<impl View> {
    let rendered_month = requested.get();
    // Load and validate the requested month's dates here.
    let focus = after_render(expr!(|scope: EffectContext| {
        if requested.get() == rendered_month {
            raw!("${scope}.element.querySelector('[data-day]')?.focus()");
        }
    }));
    Ok(view! {
        <section (focus)>
            <h2>"Month " (rendered_month)</h2>
            <button data-day="">"First available day"</button>
        </section>
    })
}

#[component]
async fn calendar(cx: &Cx) -> Result<impl View> {
    let requested = signal(cx, || 1usize);
    Ok(view! {
        <button @click=$(|_event| requested.increment())>"Next month"</button>
        month_grid(requested: requested)
    })
}
```

The hook travels with the returned month. The runtime rejects canceled requests and stale render frames, and cancels a queued hook when its owner or an enclosing render starts a newer request. Starting navigation cancels queued insertion hooks in the displayed page immediately, including when an initialization effect starts that navigation. Prefetching alone leaves those hooks runnable. The requested-month comparison adds application intent validation when preserved signals and server snapshots differ. It does not establish render ownership. For focus on a specific date, capture that date with the returned markup and compare it with the current requested-date signal as well.

Each accepted insertion has its own hook invocation and resources. Replacement cleans up the previous invocation and initializes a new one even when morphing reuses the DOM element. A nested shard or live-region replacement invokes only hooks in its new content. It does not invoke an enclosing or sibling hook. Frames from an older render cannot invoke hooks inside a region now owned by a newer render. For a live region, put the hook in the emission containing the finished content. An enclosing hook does not wait for later emissions or for the stream to end.

With no insertion there is no new hook invocation. A failed request leaves existing content in place and does not invoke a hook for that request. It does not disable future hooks. A later accepted nested render or live swap owns a fresh hook, including a swap from an earlier transport that still owns the region. A failure after an accepted stream insertion does not undo a hook that already ran. Committing navigation, replacing content, or removing its scope cancels pending work and releases registered resources. If an element is removed directly by external JavaScript before its callback runs, the callback is skipped, but external removal does not dispose the owning Topcoat scope. A hook error releases that invocation's resources and leaves other work runnable. `after_dom` callbacks belonging to ordinary effects can still run against the current DOM while a server request is pending.

# Procedures

A **procedure** is an async server function called from a runtime expression. Use one when an event handler needs a server resource, such as a database:

```rust
# use topcoat::{Result, context::Cx, runtime::{procedure, signal}, view::*};
#[procedure]
async fn double(value: usize) -> Result<usize> {
    Ok(value * 2)
}

# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
let count = signal(cx, || 1usize);

Ok(view! {
    <button @click=$(async |_e| {
        let doubled = double(count.get()).await;
        count.set(doubled);
    })>
        "double it"
    </button>
})
# }
```

The browser sends an HTTP request with the arguments and waits for the result. **Validate arguments and authorize access inside the procedure**, since callers can send their own requests. See [`#[procedure]`][procedure] for usage details.

# Shards

A **shard** is a component that re-renders on the server when its inputs change. Use one to update markup from server data, such as search results. Arguments accept fixed values or runtime expressions:

```rust
# use topcoat::{Result, context::Cx, view::*, runtime::{shard, signal, Event}};
# async fn search_products(_cx: &Cx, _query: &str) -> Result<Vec<String>> { Ok(vec![]) }
#[shard]
async fn search_results(cx: &Cx, query: String) -> Result<impl View> {
    let products = search_products(cx, &query).await?;
    Ok(view! {
        for product in products {
            <div>(product)</div>
        }
    })
}

# #[component]
# async fn example(cx: &Cx) -> Result<impl View> {
let query = signal(cx, String::new);

Ok(view! {
    <input @input=$(|e: Event| query.set(e.target.value))>

    search_results(query: $(query.get()))
})
# }
```

A shard has its own HTTP endpoint. **Validate its arguments and authorize access inside the shard**. Its page and layout guards do not run for requests to that endpoint. See [`#[shard]`][shard] for usage details.

# Reading signals on the server

Read a signal in server Rust with `.get()` to clone its value or `.read()` to borrow it. These are **tracked reads**. A change in the browser causes the page to re-render on the server with the new value:

```rust
// src/app/search.rs
# use topcoat::{Result, context::Cx, router::page, runtime::{Event, signal}, view::*};
# async fn search_products(_cx: &Cx, _query: &str) -> Result<Vec<String>> { Ok(vec![]) }
#[page]
async fn search(cx: &Cx) -> Result<impl View> {
    let query = signal(cx, String::new);
    let products = search_products(cx, &query.get()).await?;

    Ok(view! {
        <input :value=$(query.get()) @input=$(|e: Event| query.set(e.target.value))>

        for product in products {
            <div>(product)</div>
        }
    })
}
```

The input updates in the browser while the server refreshes the product list. On re-render, [`signal`] restores the value sent by the browser. Reads inside `$(...)` update browser expressions and do not trigger a server render.

**Every value read on the server is user input and must not be trusted.** The client holds the signal and can send anything that fits its type, so validate the value before acting on it, exactly like a shard argument.

The browser updates existing elements in place to preserve focus, scroll position, and input state. Signals keep their values. Give items in a reorderable list stable IDs so each element follows its item.

To avoid re-running the whole page, use a shard: a signal tracked inside a shard re-renders only that shard, not the entire page. The shard creates the signal, reads it, and hands the browser the handlers that change it:

```rust
# use topcoat::{Result, context::Cx, runtime::{shard, signal}, view::*};
# async fn load_page(_cx: &Cx, _page: usize) -> Result<Vec<String>> { Ok(vec![]) }
#[shard]
async fn paginated(cx: &Cx) -> Result<impl View> {
    let page = signal(cx, || 1usize);
    let items = load_page(cx, page.get()).await?;

    Ok(view! {
        for item in items {
            <div>(item)</div>
        }

        <button @click=$(|_e| {
            if page.get() > 1 {
                page.decrement()
            }
        })>"previous"</button>
        <button @click=$(|_e| page.increment())>"next"</button>
    })
}
```

Clicking a button changes `page` in the browser, and because the shard read it on the server, the shard runs again with the new value and swaps in the next page of items.

A shard can also take a signal from its caller, through a parameter typed `Signal<T>` and passed directly as `signal`. The signal handle does not change when its value does, so whether a change re-renders the shard depends on how the shard body reads it. See [`#[shard]`][shard].

Use `.get_untracked()` or `.read_untracked()` to read a value on the server without making changes to it trigger another render.

[`Event`]: struct.Event.html
[`EventTarget`]: struct.EventTarget.html
[`EffectContext`]: struct.EffectContext.html
[`effect`]: fn.effect.html
[`ElementRef`]: struct.ElementRef.html
[`ElementRefError`]: struct.ElementRefError.html
[`HtmlElement`]: struct.HtmlElement.html
[`InputElement`]: struct.InputElement.html
[`SelectElement`]: struct.SelectElement.html
[`TextAreaElement`]: struct.TextAreaElement.html
[`DialogElement`]: struct.DialogElement.html
[`after_render`]: fn.after_render.html
[`Expr::dynamic`]: struct.Expr.html#method.dynamic
[`expr!`]: macro.expr.html
[`signal`]: fn.signal.html
[`view!`]: ../view/macro.view.html
[procedure]: attr.procedure.html
[shard]: attr.shard.html
