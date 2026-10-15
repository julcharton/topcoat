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
[`ElementRef`]: struct.ElementRef.html
[`ElementRefError`]: struct.ElementRefError.html
[`HtmlElement`]: struct.HtmlElement.html
[`InputElement`]: struct.InputElement.html
[`SelectElement`]: struct.SelectElement.html
[`TextAreaElement`]: struct.TextAreaElement.html
[`DialogElement`]: struct.DialogElement.html
[`Expr::dynamic`]: struct.Expr.html#method.dynamic
[`expr!`]: macro.expr.html
[`signal`]: fn.signal.html
[`view!`]: ../view/macro.view.html
[procedure]: attr.procedure.html
[shard]: attr.shard.html
