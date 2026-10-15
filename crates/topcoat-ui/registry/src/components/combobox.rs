use std::collections::HashSet;

use topcoat::{
    Error, Result,
    context::Cx,
    runtime::{
        Effect, EffectContext, ElementRef, Event, Expr, HtmlElement, InputElement, ScrollAlignment,
        ScrollIntoViewOptions, Signal, after_render, effect, expr, record, signal,
    },
    view::{
        AttributeValue, Attributes, Child, View, attributes, class, component, element_id, view,
    },
};

use super::{
    floating::{FLOATING_SCOPE, FloatingAlign, FloatingAnchor, FloatingSide, floating_variants},
    input::input,
};

/// A choice in a server-owned combobox catalog. Values must be unique and nonempty.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComboboxOption {
    /// The value submitted by the form.
    pub value: String,
    /// The text displayed and searched on the server.
    pub label: String,
    /// Whether this choice is unavailable for selection.
    pub disabled: bool,
}

impl ComboboxOption {
    fn validate(options: &[Self]) -> Result<()> {
        let mut values = HashSet::with_capacity(options.len());
        for option in options {
            if option.value.is_empty() || !values.insert(&option.value) {
                return Err(Error::msg("combobox values must be unique and nonempty"));
            }
        }
        Ok(())
    }

    fn selected(options: &[Self], value: &str) -> Option<Selection> {
        options
            .iter()
            .find(|option| !option.disabled && option.value == value)
            .map(|option| Selection {
                value: option.value.clone(),
                label: option.label.clone(),
            })
    }
}

#[record]
#[derive(Clone)]
struct Selection {
    value: String,
    label: String,
}

#[record]
#[derive(Clone)]
struct Search {
    query: String,
    revision: usize,
}

#[record]
#[derive(Clone)]
struct Choice {
    value: String,
    label: String,
    id: String,
    index: usize,
    revision: usize,
}

#[record]
struct Choices {
    rows: Vec<Choice>,
    revision: Option<usize>,
}

/// The state shared by a combobox shell and its application's results shard.
///
/// Create one state per control. Pass the complete, authorized catalog to [`new`](Self::new)
/// and [`combobox_results`]. Only rendered results cross into the browser. The catalog
/// is searched on the server, never in a browser expression.
#[record]
#[derive(Clone)]
pub struct ComboboxState {
    input_id: String,
    label_id: String,
    popup_id: String,
    default_value: String,
    search: Signal<Search>,
    selection: Signal<Option<Selection>>,
    default_selection: Signal<Option<Selection>>,
    draft: Signal<String>,
    choices: Signal<Choices>,
    active: Signal<Option<Choice>>,
    choose: Signal<Option<Choice>>,
    pending: Signal<i32>,
    open: Signal<bool>,
    focused: Signal<bool>,
    composing: Signal<bool>,
    completing: Signal<bool>,
    invalid: Signal<bool>,
    edits: Signal<usize>,
}

impl ComboboxState {
    /// Creates a control with an eligible reset default, or no initial selection.
    ///
    /// Missing and disabled defaults become empty. Use keyed component identities
    /// for controls in loops. Catalog values must be unique and nonempty.
    ///
    /// # Errors
    ///
    /// Returns an error if the catalog contains empty or duplicate values.
    #[track_caller]
    pub fn new(cx: &Cx, options: &[ComboboxOption], default_value: Option<&str>) -> Result<Self> {
        ComboboxOption::validate(options)?;
        Ok(Self::initialize(&cx.keyed(()), options, default_value))
    }

    // Keep the caller's identity without forwarding its location to every signal.
    fn initialize(cx: &Cx, options: &[ComboboxOption], default_value: Option<&str>) -> Self {
        let default_value = default_value.unwrap_or_default().to_owned();
        let selected = ComboboxOption::selected(options, &default_value);
        Self {
            input_id: element_id(cx),
            label_id: element_id(cx),
            popup_id: element_id(cx),
            default_value,
            search: signal(cx, || Search {
                query: String::new(),
                revision: 0,
            }),
            selection: signal(cx, || selected.clone()),
            default_selection: signal(cx, || selected.clone()),
            draft: signal(cx, || {
                selected.map_or_else(String::new, |value| value.label)
            }),
            choices: signal(cx, || Choices {
                rows: Vec::new(),
                revision: None,
            }),
            active: signal(cx, || None::<Choice>),
            choose: signal(cx, || None::<Choice>),
            pending: signal(cx, || 0i32),
            open: signal(cx, || false),
            focused: signal(cx, || false),
            composing: signal(cx, || false),
            completing: signal(cx, || false),
            invalid: signal(cx, || false),
            edits: signal(cx, || 0usize),
        }
    }

    /// The stable input ID for a label's `for` attribute.
    #[must_use]
    pub fn input_id(&self) -> &str {
        &self.input_id
    }

    /// The stable ID for the visible label shared by the input and popup.
    #[must_use]
    pub fn label_id(&self) -> &str {
        &self.label_id
    }

    /// The committed form value. Typing clears selection until a choice is committed.
    #[must_use]
    pub fn value(&self) -> Expr<Option<String>> {
        let selected = &self.selection;
        expr!(if selected.get().is_some() {
            Some(selected.get().unwrap().value)
        } else {
            None
        })
    }

    fn current(&self) -> Expr<bool> {
        let state_search = self.search.clone();
        let state_choices = self.choices.clone();
        let state_composing = self.composing.clone();

        expr!(if state_composing.get() {
            false
        } else {
            let revision = state_choices.read().revision.clone();
            if revision.is_some() {
                revision.unwrap() == state_search.read().revision
            } else {
                false
            }
        })
    }

    fn edit(&self, completed: bool) -> Expr<impl FnOnce(Event) + use<>> {
        let state_search = self.search.clone();
        let state_selection = self.selection.clone();
        let state_draft = self.draft.clone();
        let state_active = self.active.clone();
        let state_pending = self.pending.clone();
        let state_open = self.open.clone();
        let state_composing = self.composing.clone();
        let state_completing = self.completing.clone();
        let state_invalid = self.invalid.clone();
        let state_edits = self.edits.clone();

        expr!(|event: Event| {
            if completed {
                state_composing.set(false);
                state_completing.set(true);
            }
            let text = event.target.value;
            state_edits.increment();
            state_draft.set(text.clone());
            state_active.set(None);
            state_pending.set(0i32);
            state_selection.set(None);
            state_invalid.set(false);
            state_open.set(true);
            if !state_composing.get() {
                if !event.is_composing {
                    if text != state_search.read().query {
                        state_search.set(Search {
                            query: text,
                            revision: state_search.read().revision.clone() + 1,
                        });
                    }
                }
            }
        })
    }

    fn keyboard(&self) -> Expr<impl FnOnce(Event) + use<>> {
        let state_choices = self.choices.clone();
        let state_active = self.active.clone();
        let state_choose = self.choose.clone();
        let state_pending = self.pending.clone();
        let state_open = self.open.clone();
        let state_composing = self.composing.clone();
        let state_completing = self.completing.clone();

        let current = self.current();
        expr!(|event: Event| {
            let modified = if event.alt_key {
                true
            } else if event.ctrl_key {
                true
            } else if event.meta_key {
                true
            } else {
                event.shift_key
            };
            let composing = if event.is_composing {
                true
            } else {
                state_composing.get()
            };
            if !composing {
                if state_completing.get() {
                    if event.key == "Enter" {
                        event.prevent_default();
                    }
                } else if event.key == "Enter" {
                    if state_open.get() {
                        event.prevent_default();
                        if current {
                            state_choose.set(state_active.get());
                        }
                    }
                } else if !modified {
                    let direction = if event.key == "ArrowDown" {
                        1i32
                    } else if event.key == "ArrowUp" {
                        -1i32
                    } else {
                        0i32
                    };
                    if direction != 0i32 {
                        event.prevent_default();
                        state_open.set(true);
                        if current {
                            let rows = state_choices.read().rows.as_slice();
                            if !rows.is_empty() {
                                let index = if state_active.get().is_some() {
                                    let index = state_active.get().unwrap().index;
                                    if direction > 0i32 {
                                        if index + 1 < rows.len() {
                                            index + 1
                                        } else {
                                            index
                                        }
                                    } else if index > 0 {
                                        index - 1
                                    } else {
                                        index
                                    }
                                } else if direction > 0i32 {
                                    0
                                } else {
                                    rows.len() - 1
                                };
                                state_active.set(Some(rows.index(index).clone()));
                            }
                        } else {
                            state_pending.set(direction);
                        }
                    } else if event.key == "Escape" {
                        if state_open.get() {
                            event.prevent_default();
                            event.stop_propagation();
                            state_open.set(false);
                            state_active.set(None);
                            state_pending.set(0i32);
                        }
                    }
                }
            }
        })
    }

    // This effect owns interaction reconciliation, not the lifetime of form listeners.
    fn control(&self, disabled: &Expr<bool>) -> Effect {
        let disabled = disabled.clone();
        let state_search = self.search.clone();
        let state_selection = self.selection.clone();
        let state_draft = self.draft.clone();
        let state_choices = self.choices.clone();
        let state_active = self.active.clone();
        let state_pending = self.pending.clone();
        let state_choose = self.choose.clone();
        let state_open = self.open.clone();
        let state_invalid = self.invalid.clone();
        let state_edits = self.edits.clone();

        let state_composing = self.composing.clone();
        let state_completing = self.completing.clone();
        let current = self.current();
        let input_ref = ElementRef::<InputElement>::new(self.input_id.clone());
        let popup = ElementRef::<HtmlElement>::new(self.popup_id.clone());
        effect(expr!(|_scope: EffectContext| {
            let resolved = input_ref.resolve();
            if resolved.is_ok() {
                let element = resolved.unwrap();
                let unavailable = if disabled {
                    true
                } else {
                    raw!("cx.hydrate(${element}.node.matches(':disabled'))", false)
                };
                if state_choose.get().is_some() {
                    let choice = state_choose.get().unwrap();
                    state_choose.set(None);
                    let eligible = if unavailable {
                        false
                    } else if !current {
                        false
                    } else if choice.revision != state_search.read().revision {
                        false
                    } else {
                        let rows = state_choices.read().rows.as_slice();
                        if rows.get(choice.index).is_some() {
                            rows.index(choice.index).value == choice.value
                        } else {
                            false
                        }
                    };
                    if eligible {
                        state_selection.set(Some(Selection {
                            value: choice.value,
                            label: choice.label.clone(),
                        }));
                        state_draft.set(choice.label);
                        state_search.set(Search {
                            query: "".to_owned(),
                            revision: state_search.read().revision.clone() + 1,
                        });
                        state_edits.increment();
                        state_open.set(false);
                        state_active.set(None);
                        state_pending.set(0i32);
                        state_invalid.set(false);
                    }
                }
                if unavailable {
                    state_open.set(false);
                    state_active.set(None);
                    state_pending.set(0i32);
                }
                let message = if state_composing.get() {
                    "Finish entering text before submitting."
                } else if state_completing.get() {
                    "Finish entering text before submitting."
                } else if state_selection.get().is_none() {
                    if state_draft.get().is_empty() {
                        ""
                    } else {
                        "Choose an option from the list."
                    }
                } else {
                    ""
                };
                element.set_custom_validity(message).ok();
                let panel = popup.resolve();
                if panel.is_ok() {
                    let panel = panel.unwrap();
                    let visibility = if state_open.get() {
                        panel.show_popover()
                    } else {
                        panel.hide_popover()
                    };
                    if visibility.is_ok() {
                        if visibility.unwrap() != state_open.get() {
                            state_open.set(false);
                            state_active.set(None);
                            state_pending.set(0i32);
                        }
                    }
                }
            }
        }))
    }

    fn form_effect(&self) -> Effect {
        let complete_state = self.clone();
        let reset_state = self.clone();
        let edits = self.edits.clone();
        effect(expr!(|scope: EffectContext| {
            let _scope = scope.clone();
            let _edits = edits;
            let _complete = || {
                complete_state.completing.set(false);
            };
            let _reset = || {
                let reset_state = reset_state;
                let selected = reset_state.default_selection.get();
                reset_state.draft.set(if selected.is_some() {
                    selected.clone().unwrap().label
                } else {
                    "".to_owned()
                });
                reset_state.selection.set(selected);
                reset_state.search.set(Search {
                    query: "".to_owned(),
                    revision: reset_state.search.read().revision.clone() + 1,
                });
                reset_state.edits.increment();
                reset_state.open.set(false);
                reset_state.active.set(None);
                reset_state.pending.set(0i32);
                reset_state.choose.set(None);
                reset_state.composing.set(false);
                reset_state.completing.set(false);
                reset_state.invalid.set(false);
            };
            // Native tasks observe the completed default action, including cancellation
            // by later listeners. These tasks never wait for rendered server content.
            raw!("(() => {
                const node = ${_scope}.element, signal = ${_scope}.abortSignal;
                const tasks = new Set();
                const later = callback => {
                    const task = setTimeout(() => {
                        tasks.delete(task);
                        if (!signal.aborted && node.isConnected) callback();
                    }, 0);
                    tasks.add(task);
                };
                signal.addEventListener('abort', () => tasks.forEach(clearTimeout), {once:true});
                node.addEventListener('compositionend', () => later(${_complete}), {signal});
                node.form?.addEventListener('reset', event => {
                    const revision = ${_edits}.get();
                    later(() => {
                        if (!event.defaultPrevented && ${_edits}.get().eq(revision).dehydrate()) ${_reset}();
                    });
                }, {signal});
            })();", ());
        }))
    }
}

/// An editable single-selection control with server-rendered search results.
///
/// Put an application-owned shard calling [`combobox_results`] in `child`. Its
/// catalog must remain on the server. `name` names the hidden successful control;
/// the visible input validates selection and never submits its search text.
/// Optional empty input is valid; nonempty text needs an explicit choice.
///
/// Give the visible label [`ComboboxState::label_id`] as its ID and
/// [`ComboboxState::input_id`] as its `for` attribute. Explicit `aria-label` or
/// `aria-labelledby` in `attrs` names both the input and popup.
/// When both naming values are absent or whitespace-only under Rust's rules,
/// the popup references the visible label.
/// Classes go on the wrapper. Other attributes go on the input. IDs, form/value
/// bindings, accessibility state and interaction handlers are reserved.
#[component]
pub async fn combobox(
    cx: &Cx,
    state: ComboboxState,
    name: &str,
    #[into]
    #[default(false.into())]
    required: Expr<bool>,
    #[into]
    #[default(false.into())]
    disabled: Expr<bool>,
    #[default] form: Option<&str>,
    #[default] mut attrs: Attributes,
    child: Child<'_>,
) -> Result<impl View> {
    let classes = attrs.remove("class");
    let state_input_id = state.input_id.clone();
    let state_popup_id = state.popup_id.clone();
    let state_draft = state.draft.clone();
    let state_active = state.active.clone();
    let state_pending = state.pending.clone();
    let state_open = state.open.clone();
    let state_focused = state.focused.clone();
    let state_composing = state.composing.clone();
    let state_invalid = state.invalid.clone();

    let reserved = [
        "id",
        "type",
        "name",
        "value",
        "form",
        "required",
        "disabled",
        "readonly",
        "list",
        "autocomplete",
        "role",
        "aria-controls",
        "aria-expanded",
        "aria-autocomplete",
        "aria-activedescendant",
        "aria-required",
        "aria-invalid",
        "data-topcoat-effect",
        "data-topcoat-after-render",
    ];
    let mut forwarded = Attributes::new();
    forwarded.extend(attrs.into_iter().filter(|(key, _)| {
        let key = key.as_str().to_ascii_lowercase();
        !reserved.contains(&key.as_str())
            && !key.starts_with("on")
            && !key.starts_with("data-topcoat-on:")
            && !key
                .strip_prefix("data-topcoat-bind:")
                .is_some_and(|key| reserved.contains(&key))
    }));
    let mut popup_naming = Attributes::new();
    for (key, value) in &forwarded {
        let name = key.as_str().to_ascii_lowercase();
        let attribute = name.strip_prefix("data-topcoat-bind:").unwrap_or(&name);
        if matches!(attribute, "aria-label" | "aria-labelledby") {
            popup_naming.insert(cx, name, value);
        }
    }
    let [has_label, has_reference] =
        ["aria-label", "aria-labelledby"].map(|name| match popup_naming.get(name) {
            Some(AttributeValue::PromotedStr { value, .. }) => !value.trim().is_empty(),
            Some(AttributeValue::StaticStr { value, .. }) => !value.trim().is_empty(),
            Some(AttributeValue::String { value, .. }) => !value.trim().is_empty(),
            _ => false,
        });
    let label = popup_naming.get("data-topcoat-bind:aria-label").cloned();
    let reference = popup_naming
        .get("data-topcoat-bind:aria-labelledby")
        .cloned();
    if !has_label && !has_reference {
        popup_naming.insert(cx, "aria-labelledby", state.label_id());
    }
    if reference.is_some() || (!has_reference && label.is_some()) {
        // Attributes retain compiled bindings, not their original Expr types.
        // Compose only the two naming bindings, preserving their escaping and
        // signal reads. An explicit label must not be masked by our reference.
        // Hydrate text before trimming to use Rust's Unicode whitespace rules.
        let reference_end = if reference.is_some() { ")" } else { "null)" };
        let label_start = if label.is_some() {
            "named(("
        } else if has_label {
            "true"
        } else {
            "false"
        };
        let label_end = if label.is_some() { "))" } else { "" };
        let (_, fallback) = Expr::from(state.label_id().to_owned()).into_evaluated_and_js();
        popup_naming.insert(
            cx,
            "data-topcoat-bind:aria-labelledby",
            (
                "(() => { const named = value => value.isAttributePresent() && cx.hydrate(value.toAttributeValue()).trim().toAttributeValue() !== ''; const reference = (",
                reference,
                reference_end,
                "; return reference && named(reference) ? reference : ",
                label_start,
                label,
                label_end,
                " ? null : ",
                fallback,
                "; })()",
            ),
        );
    }
    let input_ref = ElementRef::<InputElement>::new(state_input_id.clone());
    let current = state.current();
    let selected = state.value();
    let control = state.control(&disabled);
    let form_effect = state.form_effect();
    let edit = state.edit(false);
    let complete = state.edit(true);
    let keyboard = state.keyboard();
    let wrapper = ElementRef::<HtmlElement>::new(format!("{state_input_id}-root"));
    Ok(view! {
        <div
            id=(wrapper.id())
            class=(class!("relative w-full", FLOATING_SCOPE, classes))
            (control)
            @focusout=$(|event: Event| {
                let internal = if event.related_target.is_some() {
                    let root = wrapper.resolve();
                    if root.is_ok() {
                        let contains = root
                            .unwrap()
                            .contains(event.related_target.unwrap());
                        if contains.is_ok() { contains.unwrap() } else { false }
                    } else {
                        false
                    }
                } else {
                    false
                };
                if !internal {
                    state_focused.set(false);
                    state_open.set(false);
                    state_active.set(None);
                    state_pending.set(0i32);
                }
            })
        >
            input(
                attrs: attributes! {
                    (forwarded)
                    id=(&state_input_id)
                    type="text"
                    role="combobox"
                    autocomplete="off"
                    form=(form)
                    :required=(required.clone())
                    :disabled=(disabled.clone())
                    :value=$(state_draft.get())
                    aria-autocomplete="list"
                    aria-controls=(&state_popup_id)
                    :aria-required=$(if required { "true" } else { "false" })
                    :aria-expanded=$(if state_open.get() { "true" } else { "false" })
                    :aria-invalid=$(if state_invalid.get() {
                        Some("true")
                    } else {
                        None
                    })
                    :aria-activedescendant=$(if state_open.get() {
                        if current {
                            if state_active.get().is_some() {
                                Some(state_active.get().unwrap().id)
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    })
                    @input=(edit)
                    @compositionstart=$(|_event: Event| {
                        state_composing.set(true);
                        state_active.set(None);
                        state_pending.set(0i32);
                        // requestSubmit() can dispatch before reactive effects run.
                        let field = input_ref.resolve();
                        if field.is_ok() {
                            field
                                .unwrap()
                                .set_custom_validity(
                                    "Finish entering text before submitting.",
                                )
                                .ok();
                        }
                    })
                    @compositionend=(complete)
                    @keydown=(keyboard)
                    @focus=$(|_event: Event| state_focused.set(true))
                    @click=$(|_event: Event| state_open.set(true))
                    @invalid=$(|_event: Event| state_invalid.set(true))
                    (form_effect)
                }
            )
            <input
                type="hidden"
                name=(name)
                form=(form)
                :disabled=(disabled)
                :value=$(if selected.is_some() {
                    selected.unwrap()
                } else {
                    "".to_owned()
                })
            >
            <div
                id=(&state_popup_id)
                popover="auto"
                role="listbox"
                (popup_naming)
                class=(class!(
                    floating_variants(
                        FloatingAnchor::Scope,
                        FloatingSide::Bottom,
                        FloatingAlign::Start,
                    ),
                    "inset-auto m-0 max-h-64 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto",
                    "rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-sm",
                    "supports-[anchor-name:--floating-anchor]:w-[anchor-size(width)]",
                    "not-supports-[anchor-name:--floating-anchor]:inset-0",
                    "not-supports-[anchor-name:--floating-anchor]:m-auto",
                    "not-supports-[anchor-name:--floating-anchor]:h-fit",
                ))
                @toggle=$(|event: Event| {
                    if event.new_state.is_some() {
                        let open = event.new_state.unwrap() == "open";
                        if open {
                            state_open.set(true);
                        } else {
                            state_open.set(false);
                            state_active.set(None);
                            state_pending.set(0i32);
                        }
                    }
                })
            >
                <div
                    role="status"
                    class="px-2 py-2 text-sm text-muted-foreground"
                    :hidden=$(current)
                >
                    "Searching..."
                </div>
                (child)
            </div>
        </div>
    })
}

/// Searches the complete current catalog on the server and renders matching choices.
///
/// Call this inside an application shard, loading and authorizing the catalog there.
/// Matching uses Rust Unicode lowercase and substring matching on labels. A missing
/// search match does not invalidate a selection; removal or disabling in the full
/// catalog does. Every live emission must include this component's initialization.
#[component]
pub async fn combobox_results(
    cx: &Cx,
    state: ComboboxState,
    options: &[ComboboxOption],
) -> Result<impl View> {
    ComboboxOption::validate(options)?;
    let state_default_value = state.default_value.clone();
    let state_search = state.search.clone();
    let state_selection = state.selection.clone();
    let state_default_selection = state.default_selection.clone();
    let state_draft = state.draft.clone();
    let state_choices = state.choices.clone();
    let state_active = state.active.clone();
    let state_pending = state.pending.clone();
    let state_open = state.open.clone();
    let state_focused = state.focused.clone();
    let state_composing = state.composing.clone();

    let search = state_search.get();
    // Search revisions publish edits/commits. Selection alone must not cause a
    // search request while the native input is composing text.
    let selected = state_selection.get_untracked();
    let selected_value = selected.as_ref().map(|value| value.value.clone());
    let selection = selected.and_then(|value| ComboboxOption::selected(options, &value.value));
    let default = ComboboxOption::selected(options, &state_default_value);
    let query = search.query.to_lowercase();
    let revision = search.revision;
    let mut eligible = Vec::new();
    let mut rows = Vec::new();
    for option in options
        .iter()
        .filter(|option| option.label.to_lowercase().contains(&query))
    {
        let choice = Choice {
            value: option.value.clone(),
            label: option.label.clone(),
            id: element_id(&cx.keyed(&option.value)),
            index: eligible.len(),
            revision,
        };
        if !option.disabled {
            eligible.push(choice.clone());
        }
        rows.push((choice, option.disabled));
    }
    let eligible = eligible.as_slice();
    let current = state.current();
    let accepted = after_render(expr!(|_scope: EffectContext| {
        if state_search.read().revision == revision {
            state_choices.set(Choices {
                rows: eligible.to_vec(),
                revision: Some(revision),
            });
            state_default_selection.set(default);
            let selected_now = if state_selection.get().is_some() {
                Some(state_selection.get().unwrap().value)
            } else {
                None
            };
            let same_selection = if selected_now.is_some() {
                if selected_value.is_some() {
                    selected_now.unwrap() == selected_value.unwrap()
                } else {
                    false
                }
            } else {
                selected_value.is_none()
            };
            if same_selection {
                if state_selection.get().is_some() {
                    state_selection.set(selection.clone());
                    state_draft.set(if selection.is_some() {
                        selection.unwrap().label
                    } else {
                        "".to_owned()
                    });
                }
            }
            // Reconcile callback-time identity against this accepted snapshot.
            let rows = state_choices.read().rows.as_slice();
            let active = state_active.get();
            let retained = if active.is_some() {
                let value = active.unwrap().value;
                let position = rows.iter().position(|row| row.value == value);
                if position.is_some() {
                    Some(rows.index(position.unwrap()).clone())
                } else {
                    None
                }
            } else {
                None
            };
            state_active.set(retained);
            if state_open.get() {
                if state_focused.get() {
                    if !state_composing.get() {
                        if !rows.is_empty() {
                            if state_pending.get() > 0i32 {
                                state_active.set(Some(rows.first().unwrap().clone()));
                            } else if state_pending.get() < 0i32 {
                                state_active.set(Some(rows.last().unwrap().clone()));
                            }
                        }
                    }
                }
            }
            state_pending.set(0i32);
        }
    }));
    Ok(view! {
        <div
            (accepted)
            :hidden=$(if current {
                state_search.read().revision != revision
            } else {
                true
            })
        >
            if rows.is_empty() {
                <div role="status" class="px-2 py-2 text-sm text-muted-foreground">
                    "No matches."
                </div>
            }
            #[key(choice.value)]
            for (choice, disabled) in rows {
                combobox_option(
                    state: state.clone(),
                    choice: choice,
                    disabled: disabled
                )
            }
        </div>
    })
}

#[component]
async fn combobox_option(
    state: ComboboxState,
    choice: Choice,
    disabled: bool,
) -> Result<impl View> {
    let state_input_id = state.input_id.clone();
    let state_active = state.active.clone();
    let state_choose = state.choose.clone();
    let state_open = state.open.clone();
    let active = expr!(if state_active.get().is_some() {
        state_active.get().unwrap().id == choice.id
    } else {
        false
    });
    let current = state.current();
    let reference = ElementRef::<HtmlElement>::new(choice.id.clone());
    let input_ref = ElementRef::<InputElement>::new(state_input_id.clone());
    let scroll_options = ScrollIntoViewOptions {
        block: ScrollAlignment::Nearest,
        inline: ScrollAlignment::Nearest,
        ..Default::default()
    };
    let scroll = effect(expr!(|scope: EffectContext| {
        if active {
            if current {
                if state_open.get() {
                    scope.after_dom(|| {
                        let node = reference.resolve();
                        if node.is_ok() {
                            node.unwrap().scroll_into_view(scroll_options).ok();
                        }
                    });
                }
            }
        }
    }));
    Ok(view! {
        <div
            id=(&choice.id)
            role="option"
            aria-disabled=(if disabled { "true" } else { "false" })
            :aria-selected=$(if active { "true" } else { "false" })
            class="cursor-default rounded-md px-2 py-2 text-sm select-none \
                aria-selected:bg-foreground/10 aria-selected:text-foreground \
                aria-disabled:opacity-50 not-aria-disabled:hover:bg-foreground/5"
            @mousedown=$(|event: Event| {
                if event.button == 0.0 {
                    event.prevent_default();
                }
            })
            @click=$(|_event: Event| {
                if !disabled {
                    if current {
                        let field = input_ref.resolve();
                        if field.is_ok() {
                            field.unwrap().focus(true).ok();
                            state_choose.set(Some(choice.clone()));
                        }
                    }
                }
            })
            (scroll)
        >
            (&choice.label)
        </div>
    })
}
