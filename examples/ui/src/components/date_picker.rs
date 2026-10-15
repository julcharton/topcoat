//! Labeled date fields with a native calendar popover.

use topcoat::{
    Result,
    context::Cx,
    runtime::{EffectContext, ElementRef, Event, Expr, HtmlElement, Signal, effect, expr},
    view::{Attributes, View, ViewExt, class, component, element_id, view},
};

use super::{
    calendar::calendar_control,
    calendar_date::{CalendarDate, DateConstraints, DateRange, WeekStart},
    calendar_state::{CalendarRules, CalendarSelection, CalendarState, DateRangeValue},
    date_field::{DateValidation, date_input, date_validation, reset_effect},
    floating::{FloatingAlign, FloatingAnchor, FloatingSide, floating_variants},
};

/// A labeled ISO date input and native non-modal calendar popover.
///
/// `value` owns the editable text. `default_value` controls form reset and defaults
/// to empty. Supply `today` in the application's timezone as a civil date.
/// Manual entries are checked on the server and block checked submission while
/// pending. Validate again in the form handler. `attrs` belongs to the wrapper;
/// `input_attrs` adds presentation and accessibility attributes to the input.
#[component]
pub async fn date_picker(
    cx: &Cx,
    value: Signal<String>,
    today: CalendarDate,
    name: &str,
    label: &str,
    #[default] default_value: Option<CalendarDate>,
    #[into]
    #[default(false.into())]
    required: Expr<bool>,
    #[into]
    #[default(false.into())]
    disabled: Expr<bool>,
    #[default] form: Option<&str>,
    #[default] initial_month: Option<CalendarDate>,
    #[default] week_start: WeekStart,
    #[default] constraints: DateConstraints,
    #[default] attrs: Attributes,
    #[default] input_attrs: Attributes,
) -> Result<impl View> {
    let rules = CalendarRules::new(today, week_start, &constraints)?;
    let state = CalendarState::new(
        cx,
        CalendarSelection::Single(value),
        &rules,
        initial_month,
        false,
        disabled.clone().into_evaluated_and_js().0,
    )?;
    let defaults = DateRangeValue {
        start: default_value.map_or_else(String::new, |date| date.to_string()),
        end: String::new(),
    };
    let reset_cursor = rules.initial(&defaults, initial_month)?.ordinal();
    Ok(view! {
        picker(
            state: state,
            rules: rules,
            names: (name, ""),
            label: label,
            defaults: defaults,
            reset_cursor: reset_cursor,
            required: required,
            disabled: disabled,
            form: form,
            attrs: attrs,
            start_attrs: input_attrs,
            end_attrs: Attributes::default()
        )
    }
    .boxed())
}

/// Two ISO date inputs selecting one inclusive range.
///
/// Both empty endpoints are valid when optional. A partial or reversed range is
/// invalid. Selecting an earlier second date starts a new range; a disabled
/// interior date rejects completion. Dismissing the popup preserves partial edits.
#[component]
pub async fn date_range_picker(
    cx: &Cx,
    value: Signal<DateRangeValue>,
    today: CalendarDate,
    start_name: &str,
    end_name: &str,
    label: &str,
    #[default] default_value: Option<DateRange>,
    #[into]
    #[default(false.into())]
    required: Expr<bool>,
    #[into]
    #[default(false.into())]
    disabled: Expr<bool>,
    #[default] form: Option<&str>,
    #[default] initial_month: Option<CalendarDate>,
    #[default] week_start: WeekStart,
    #[default] constraints: DateConstraints,
    #[default] attrs: Attributes,
    #[default] start_attrs: Attributes,
    #[default] end_attrs: Attributes,
) -> Result<impl View> {
    let rules = CalendarRules::new(today, week_start, &constraints)?;
    let state = CalendarState::new(
        cx,
        CalendarSelection::Range(value),
        &rules,
        initial_month,
        false,
        disabled.clone().into_evaluated_and_js().0,
    )?;
    let defaults = default_value.map_or_else(DateRangeValue::default, |range| DateRangeValue {
        start: range.start().to_string(),
        end: range.end().to_string(),
    });
    let reset_cursor = rules.initial(&defaults, initial_month)?.ordinal();
    Ok(view! {
        picker(
            state: state,
            rules: rules,
            names: (start_name, end_name),
            label: label,
            defaults: defaults,
            reset_cursor: reset_cursor,
            required: required,
            disabled: disabled,
            form: form,
            attrs: attrs,
            start_attrs: start_attrs,
            end_attrs: end_attrs
        )
    }
    .boxed())
}

#[component]
async fn picker(
    cx: &Cx,
    state: CalendarState,
    rules: CalendarRules,
    names: (&str, &str),
    label: &str,
    defaults: DateRangeValue,
    reset_cursor: i32,
    required: Expr<bool>,
    disabled: Expr<bool>,
    form: Option<&str>,
    mut attrs: Attributes,
    start_attrs: Attributes,
    end_attrs: Attributes,
) -> Result<impl View> {
    let validation = DateValidation::new(
        cx,
        &state.selection,
        &rules,
        required.clone().into_evaluated_and_js().0,
    )?;
    let current = validation.current(
        &state.selection,
        &required,
        &DateValidation::rules_key(&rules),
    );
    let accepted = validation.accepted.clone();
    let revision = validation.revision.clone();
    let single = state.selection.single.clone();
    let range = state.selection.range.clone();
    let is_range = state.selection.is_range;
    let close = state.close.clone();
    let open = state.open.clone();
    let wants_focus = state.wants_focus.clone();
    let queue = state.commands.clone();
    let request = state.request.clone();
    let error = expr!(if current {
        accepted.get().error
    } else {
        "Checking date...".to_owned()
    });
    let trigger = ElementRef::<HtmlElement>::new(element_id(cx));
    let popup = ElementRef::<HtmlElement>::new(element_id(cx));
    let description = element_id(cx);
    let group = element_id(cx);
    let reset = reset_effect(&state, &validation, &defaults, reset_cursor);
    let dismiss = effect(expr!(|_scope: EffectContext| {
        let closing = close.get();
        if disabled {
            wants_focus.set(false);
            open.set(false);
            let panel = popup.resolve();
            if panel.is_ok() {
                let _closed = panel.unwrap().hide_popover();
            }
        } else {
            if closing {
                wants_focus.set(false);
                let was_open = open.get();
                open.set(false);
                let panel = popup.resolve();
                if panel.is_ok() {
                    let _closed = panel.unwrap().hide_popover();
                }
                if was_open {
                    let button = trigger.resolve();
                    if button.is_ok() {
                        let _focused = button.unwrap().focus(true);
                    }
                }
            }
        }
        if closing {
            close.set(false);
        }
    }));
    Ok(view! {
        <div
            data-date-picker=""
            :data-date-pending=$(if current { "false" } else { "true" })
            class=(class!("space-y-2", attrs.remove("class")))
            (attrs)
            (reset)
        >
            if is_range {
                <p id=(&group) class="text-sm font-medium">(label)</p>
            }
            <div
                role=(is_range.then_some("group"))
                aria-labelledby=(is_range.then_some(&group))
                class="flex flex-wrap items-end gap-2"
            >
                date_input(
                    selection: state.selection.clone(),
                    validation: validation.clone(),
                    error: error.clone(),
                    name: names.0,
                    label: if is_range { "Start date" } else { label },
                    default_value: defaults.start,
                    end: false,
                    required: required.clone(),
                    disabled: disabled.clone(),
                    form: form,
                    description: &description,
                    attrs: start_attrs
                )
                if is_range {
                    date_input(
                        selection: state.selection.clone(),
                        validation: validation.clone(),
                        error: error.clone(),
                        name: names.1,
                        label: "End date",
                        default_value: defaults.end,
                        end: true,
                        required: required.clone(),
                        disabled: disabled.clone(),
                        form: form,
                        description: &description,
                        attrs: end_attrs
                    )
                }
                <button
                    id=(trigger.id())
                    type="button"
                    popovertarget=(popup.id())
                    aria-haspopup="dialog"
                    :disabled=(disabled.clone())
                    class="h-9 rounded-lg border border-border px-3 text-sm hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
                    (dismiss)
                    @focusout=$(|event: Event| {
                        if event.related_target.is_some() {
                            let panel = popup.resolve();
                            if panel.is_ok() {
                                let contained = panel
                                    .unwrap()
                                    .contains(event.related_target.unwrap());
                                if contained.is_ok() {
                                    if !contained.unwrap() {
                                        wants_focus.set(false);
                                    }
                                }
                            }
                        } else {
                            wants_focus.set(false);
                        }
                    })
                >
                    "Choose date"
                </button>
            </div>
            <div id=(&description) class="text-xs text-muted-foreground">
                <span>"YYYY-MM-DD"</span>
                <span role="status" class="ml-2 text-destructive">$(error)</span>
                <button
                    type="button"
                    :disabled=(disabled.clone())
                    class="ml-2 underline"
                    @click=$(|_event: Event| {
                        if !disabled {
                            if is_range {
                                range.set(
                                    DateRangeValue { start: "".to_owned(), end: "".to_owned() },
                                );
                            } else {
                                single.set("".to_owned());
                            }
                            revision.increment();
                            close.set(true);
                        }
                    })
                >
                    "Clear"
                </button>
                <button
                    type="button"
                    :hidden=$(current)
                    :disabled=(disabled.clone())
                    class="ml-2 underline"
                    @click=$(|_event: Event| revision.increment())
                >
                    "Retry"
                </button>
            </div>
            <div
                id=(popup.id())
                popover="auto"
                role="dialog"
                aria-label=(label)
                class=(class!(
                    floating_variants(
                        FloatingAnchor::Invoker,
                        FloatingSide::Bottom,
                        FloatingAlign::Start,
                    ),
                    // Reject collapsed anchor areas without excluding short viewports.
                    "min-h-[min(24rem,calc(50dvh-1.5rem))]",
                    // Reserve the anchor gap and keep focused dates clear of the scroll edge.
                    "max-h-[calc(100%-var(--spacing))] scroll-py-1 overflow-y-auto",
                    // A narrow viewport may fit neither start nor end alignment.
                    "[&:popover-open]:[position-try-fallbacks:flip-block,flip-inline,flip-block_flip-inline,top_span-all,bottom_span-all]",
                    "max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover text-popover-foreground",
                ))
                @beforetoggle=$(|event: Event| {
                    if event.new_state.is_some() {
                        if event.new_state.unwrap() == "closed" {
                            wants_focus.set(false);
                            open.set(false);
                        } else {
                            if !disabled {
                                wants_focus.set(true);
                            }
                        }
                    }
                })
                @toggle=$(|event: Event| {
                    if event.new_state.is_some() {
                        let opening = event.new_state.unwrap() == "open";
                        open.set(opening);
                        if opening {
                            if !disabled {
                                queue.set("o".to_owned());
                                request.increment();
                            }
                        } else {
                            wants_focus.set(false);
                        }
                    }
                })
                @keydown=$(|event: Event| {
                    if event.key == "Escape" {
                        event.prevent_default();
                        close.set(true);
                    }
                })
            >
                calendar_control(
                    state: state.clone(),
                    rules: rules.clone(),
                    disabled: disabled
                )
            </div>
            date_validation(
                selection: state.selection,
                validation: validation,
                rules: rules,
                required: required
            )
        </div>
    }.boxed())
}
