//! Private form integration shared by single-date and range pickers.

use topcoat::{
    Result,
    context::Cx,
    runtime::{
        Effect, EffectContext, ElementRef, Event, Expr, InputElement, Signal, after_render, effect,
        expr, record, shard, signal,
    },
    view::{AttributeValue, Attributes, View, ViewExt, attributes, component, element_id, view},
};

use super::{
    calendar_state::{CalendarRules, CalendarState, DateRangeValue, Selection},
    input::input,
};

#[record]
#[derive(Clone)]
pub(super) struct ValidatedDate {
    pub start: String,
    pub end: String,
    pub required: bool,
    pub rules: String,
    pub revision: u64,
    pub error: String,
}

#[record]
#[derive(Clone)]
pub(super) struct DateValidation {
    pub revision: Signal<u64>,
    pub accepted: Signal<ValidatedDate>,
}

impl DateValidation {
    pub fn new(
        cx: &Cx,
        selection: &Selection,
        rules: &CalendarRules,
        required: bool,
    ) -> Result<Self> {
        let value = selection.read(false);
        let error = rules.error(&value, selection.is_range, required)?;
        let key = Self::rules_key(rules);
        Ok(Self {
            revision: signal(cx, || 0u64),
            accepted: signal(cx, || ValidatedDate {
                start: value.start,
                end: value.end,
                required,
                rules: key,
                revision: 0,
                error,
            }),
        })
    }

    pub fn rules_key(rules: &CalendarRules) -> String {
        format!("{}:{}:{:?}", rules.min, rules.max, rules.blocked)
    }

    pub fn current(&self, selection: &Selection, required: &Expr<bool>, key: &str) -> Expr<bool> {
        let required = required.clone();
        let key = key.to_owned();
        let accepted = self.accepted.clone();
        let revision = self.revision.clone();
        let same_value =
            selection.matches(&expr!(accepted.get().start), &expr!(accepted.get().end));
        expr!({
            let accepted = accepted.get();
            if same_value {
                if accepted.required == required {
                    if accepted.rules == key {
                        accepted.revision == revision.get()
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                false
            }
        })
    }
}

#[shard]
pub(super) async fn date_validation(
    selection: Selection,
    validation: DateValidation,
    rules: CalendarRules,
    required: bool,
) -> Result<impl View> {
    let value = selection.read(true);
    let revision = validation.revision.get();
    let error = rules.error(&value, selection.is_range, required)?;
    let accepted = ValidatedDate {
        start: value.start,
        end: value.end,
        required,
        rules: DateValidation::rules_key(&rules),
        revision,
        error,
    };
    let current = selection.matches(&accepted.start.clone().into(), &accepted.end.clone().into());
    let live_revision = validation.revision.clone();
    let live_accepted = validation.accepted.clone();
    let install = after_render(expr!(|_scope: EffectContext| {
        if current {
            if live_revision.get() == revision {
                live_accepted.set(accepted);
            }
        }
    }));
    Ok(view! { <span hidden="" data-date-validation="" (install)></span> })
}

#[component]
pub(super) async fn date_input(
    cx: &Cx,
    selection: Selection,
    validation: DateValidation,
    error: Expr<String>,
    name: &str,
    label: &str,
    default_value: String,
    end: bool,
    required: Expr<bool>,
    disabled: Expr<bool>,
    form: Option<&str>,
    description: &str,
    mut attrs: Attributes,
) -> Result<impl View> {
    let is_range = selection.is_range;
    let range = selection.range.clone();
    let single = selection.single.clone();
    let revision = validation.revision.clone();

    let id = match attrs.remove("id") {
        Some(AttributeValue::String { value, .. }) => value,
        Some(AttributeValue::StaticStr { value, .. }) => value.to_owned(),
        Some(AttributeValue::PromotedStr { value, .. }) => (*value).to_owned(),
        _ => element_id(cx),
    };
    // Explicit IDs must be plain tokens, so serialized attribute escapes cannot
    // be mistaken for the live DOM identifier used by a typed reference.
    if id.is_empty()
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-:.".contains(&c))
    {
        return Err(std::io::Error::other("date input id must be an ASCII identifier").into());
    }
    for owned in [
        "type",
        "name",
        "form",
        "value",
        "required",
        "disabled",
        "readonly",
        "pattern",
        "data-topcoat-bind:value",
        "data-topcoat-bind:required",
        "data-topcoat-bind:disabled",
        "data-topcoat-on:input",
        "data-topcoat-on:change",
        "data-topcoat-effect",
    ] {
        attrs.remove(owned);
    }
    let description = match attrs.remove("aria-describedby") {
        Some(AttributeValue::String { value, .. }) => format!("{value} {description}"),
        Some(AttributeValue::StaticStr { value, .. }) => format!("{value} {description}"),
        Some(AttributeValue::PromotedStr { value, .. }) => format!("{value} {description}"),
        _ => description.to_owned(),
    };
    let reference = ElementRef::<InputElement>::new(id.clone());
    let draft = expr!(if is_range {
        if end {
            range.get().end
        } else {
            range.get().start
        }
    } else {
        single.get()
    });
    let synchronize = effect(expr!(|scope: EffectContext| {
        // Reading the live draft also schedules default restoration after every binding.
        let _draft = draft;
        let message = error;
        let target = reference.resolve();
        if target.is_ok() {
            let _validity = target.unwrap().set_custom_validity(message.trim());
        }
        let _owned = scope.clone();
        scope.after_dom(|| {
            raw!("${_owned}.element.defaultValue = ${default_value}.toString()");
        });
    }));
    Ok(view! {
        <div class="min-w-0 flex-1 basis-36 space-y-1.5">
            <label for=(&id) class="text-sm font-medium">(label)</label>
            input(
                attrs: attributes! {
                    (attrs)
                    id=(&id)
                    type="text"
                    name=(name)
                    form=(form)
                    data-date-input=""
                    pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
                    placeholder="YYYY-MM-DD"
                    aria-describedby=(&description)
                    :required=(required)
                    :disabled=(disabled)
                    :value=(draft)
                    :aria-invalid=$(if error.is_empty() { "false" } else { "true" })
                    (synchronize)
                    @input=$(|event: Event| {
                        // Block checked submission in this event, before a render can arrive.
                        let target = reference.resolve();
                        if target.is_ok() {
                            let _validity = target
                                .unwrap()
                                .set_custom_validity("Checking date...");
                        }
                        revision.increment();
                        if is_range {
                            let previous = range.get();
                            if end {
                                range.set(
                                    DateRangeValue {
                                        start: previous.start,
                                        end: event.target.value,
                                    },
                                );
                            } else {
                                range.set(
                                    DateRangeValue {
                                        start: event.target.value,
                                        end: previous.end,
                                    },
                                );
                            }
                        } else {
                            single.set(event.target.value);
                        }
                    })
                }
            )
        </div>
    }
    .boxed())
}

/// Native reset dispatch has no corresponding typed scheduling primitive. This
/// bridge owns only event/default-action timing; selection changes stay compiled Rust.
pub(super) fn reset_effect(
    state: &CalendarState,
    validation: &DateValidation,
    defaults: &DateRangeValue,
    cursor: i32,
) -> Effect {
    let single = state.selection.single.clone();
    let range = state.selection.range.clone();
    let is_range = state.selection.is_range;
    let revision = validation.revision.clone();
    let request = state.request.clone();
    let queue = state.commands.clone();
    let live_cursor = state.cursor.clone();
    let wants_focus = state.wants_focus.clone();
    let notice = state.notice.clone();
    let close = state.close.clone();
    let defaults = defaults.clone();
    let draft = if is_range {
        expr!(range.get())
    } else {
        expr!(DateRangeValue {
            start: single.get(),
            end: "".to_owned()
        })
    };
    effect(expr!(|_scope: EffectContext| {
        let _prepare = || {
            let snapshot = draft.clone();
            let edit = revision.get();
            let intent = request.get();
            || {
                let value = draft.clone();
                let current = if value.start == snapshot.start {
                    if value.end == snapshot.end {
                        if revision.get() == edit {
                            request.get() == intent
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                } else {
                    false
                };
                if current {
                    if is_range {
                        range.set(defaults);
                    } else {
                        single.set(defaults.start);
                    }
                    revision.increment();
                    queue.set("".to_owned());
                    live_cursor.set(cursor);
                    request.increment();
                    wants_focus.set(false);
                    notice.set("".to_owned());
                    close.set(true);
                }
            }
        };
        raw!(
            "(() => {
            const root = ${_scope}.element;
            const inputs = [...root.querySelectorAll('[data-date-input]')];
            const form = inputs[0]?.form;
            if (!form) return;
            let timer;
            form.addEventListener('reset', event => {
                clearTimeout(timer);
                const apply = ${_prepare}();
                timer = setTimeout(() => {
                    if (!event.defaultPrevented && !${_scope}.abortSignal.aborted
                        && inputs.every(input => input.isConnected && input.form === form)) {
                        apply();
                    }
                }, 0);
            }, { signal: ${_scope}.abortSignal });
            ${_scope}.on_cleanup(() => clearTimeout(timer));
        })()"
        );
    }))
}
