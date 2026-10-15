//! A server-rendered calendar with browser-local focus and selection.

use topcoat::{
    Result,
    context::Cx,
    runtime::{
        EffectContext, ElementRef, Event, Expr, HtmlElement, ScrollAlignment, ScrollBehavior,
        ScrollIntoViewOptions, after_render, effect, expr, shard,
    },
    view::{Attributes, View, ViewExt, class, component, element_id, view},
};

pub use super::calendar_state::{CalendarSelection, DateRangeValue};
use super::{
    calendar_date::{CalendarDate, DateConstraints, DateRange, WeekStart},
    calendar_state::{CalendarRules, CalendarState},
};

/// An inline single-date or inclusive-range calendar.
///
/// `today` is the application's civil date. `attrs` styles the wrapper. Dates
/// and navigation are computed on the server; register shards with `.discover()`.
/// The caller owns the selection signal. This component adds no named form field.
#[component]
pub async fn calendar(
    cx: &Cx,
    selection: CalendarSelection,
    today: CalendarDate,
    #[default] initial_month: Option<CalendarDate>,
    #[default] week_start: WeekStart,
    #[default] constraints: DateConstraints,
    #[into]
    #[default(false.into())]
    disabled: Expr<bool>,
    #[default] mut attrs: Attributes,
) -> Result<impl View> {
    let rules = CalendarRules::new(today, week_start, &constraints)?;
    let state = CalendarState::new(
        cx,
        selection,
        &rules,
        initial_month,
        true,
        disabled.clone().into_evaluated_and_js().0,
    )?;
    Ok(view! {
        <div class=(class!("w-fit max-w-full", attrs.remove("class"))) (attrs)>
            calendar_control(state: state, rules: rules, disabled: disabled)
        </div>
    }
    .boxed())
}

#[component]
pub(super) async fn calendar_control(
    cx: &Cx,
    state: CalendarState,
    rules: CalendarRules,
    disabled: Expr<bool>,
) -> Result<impl View> {
    let root = ElementRef::<HtmlElement>::new(element_id(cx));
    let disable = effect(expr!(|_scope: EffectContext| {
        state.disabled.set(disabled);
        if disabled {
            state.wants_focus.set(false);
        }
    }));
    Ok(view! {
        <div
            id=(root.id())
            data-calendar=""
            class="w-72 max-w-full p-2"
            (disable)
            @focusout=$(|event: Event| {
                if event.related_target.is_some() {
                    let element = root.resolve();
                    if element.is_ok() {
                        let contained = element
                            .unwrap()
                            .contains(event.related_target.unwrap());
                        if contained.is_ok() {
                            if !contained.unwrap() {
                                state.wants_focus.set(false);
                            }
                        }
                    }
                } else {
                    state.wants_focus.set(false);
                }
            })
        >
            calendar_month(state: state.clone(), rules: rules)
            <p class="mt-2 text-xs text-muted-foreground">
                "Arrows move days. Page Up/Down changes month."
            </p>
            <p role="status" class="mt-1 text-xs text-destructive">
                $(state.notice.get())
            </p>
            <div
                :hidden=$(state.request.get() == state.accepted.get())
                class="mt-2 flex items-center justify-between text-xs text-muted-foreground"
            >
                <span>"Loading calendar..."</span>
                <button
                    type="button"
                    class="rounded px-2 py-1 underline focus-visible:outline-2"
                    :disabled=$(state.disabled.get())
                    @click=$(|_event: Event| {
                        if !state.disabled.get() {
                            state.request.increment();
                        }
                    })
                >
                    "Retry"
                </button>
            </div>
        </div>
    }
    .boxed())
}

#[shard]
async fn calendar_month(state: CalendarState, rules: CalendarRules) -> Result<impl View> {
    let constraints = rules.constraints()?;
    let week = WeekStart::from_index(rules.week)?;
    let version = state.request.get();
    let value = state.selection.read(true);
    let commands = state.commands.get_untracked();
    let base = CalendarDate::from_ordinal(state.cursor.get_untracked())?;
    let cursor = if let Some(commands) = commands.strip_prefix('o') {
        constraints.navigate(rules.opening(&value)?, commands, week)?
    } else {
        constraints.navigate(base, &commands, week)?
    };
    let cursor = constraints.clamp(cursor);
    let first = cursor.first().ordinal();
    let last = cursor.last().ordinal();
    let grid_start = first - cursor.first().week_offset(week);
    // This component's generated identity prefixes stable civil-day IDs.
    Ok(view! {
        calendar_grid(
            state: state,
            rules: rules,
            version: version,
            value: value,
            cursor: cursor,
            first: first,
            last: last,
            grid_start: grid_start
        )
    }
    .boxed())
}

#[component]
async fn calendar_grid(
    cx: &Cx,
    state: CalendarState,
    rules: CalendarRules,
    version: u64,
    value: DateRangeValue,
    cursor: CalendarDate,
    first: i32,
    last: i32,
    grid_start: i32,
) -> Result<impl View> {
    let grid = element_id(cx);
    let heading = element_id(cx);
    let constraints = rules.constraints()?;
    let ordinal = cursor.ordinal();
    let selection = state.selection.clone();
    let start = value.start.clone();
    let end = value.end.clone();
    let current = expr!(if selection.is_range {
        if selection.range.get().start == start {
            selection.range.get().end == end
        } else {
            false
        }
    } else {
        selection.single.get() == start
    });
    let install = after_render(expr!(|_scope: EffectContext| {
        if state.request.get() == version {
            if current {
                state.cursor.set(ordinal);
                state.commands.set("".to_owned());
                state.accepted.set(version);
            }
        }
    }));
    let prev_disabled = cursor.first() <= constraints.minimum().first();
    let next_disabled = cursor.first() >= constraints.maximum().first();
    Ok(view! {
        <div data-calendar-month=(cursor.month_label()) (install)>
            <div class="mb-2 flex items-center justify-between gap-2">
                month_button(
                    state: state.clone(),
                    command: "p",
                    label: "Previous month",
                    boundary_disabled: prev_disabled
                )
                <h3
                    id=(&heading)
                    aria-live="polite"
                    aria-atomic="true"
                    class="text-sm font-medium"
                >
                    (cursor.month_label())
                </h3>
                month_button(
                    state: state.clone(),
                    command: "n",
                    label: "Next month",
                    boundary_disabled: next_disabled
                )
            </div>
            <table
                role="grid"
                aria-labelledby=(&heading)
                aria-multiselectable=(state.selection.is_range.then_some("true"))
                :aria-busy=$(if state.request.get() == state.accepted.get() {
                    "false"
                } else {
                    "true"
                })
                class="w-full table-fixed border-separate border-spacing-y-1 text-center text-sm tabular-nums"
            >
                <thead>
                    <tr>
                        for offset in 0..7 {
                            let name = WeekStart::NAMES[(usize::from(rules.week)
                                            + offset)
                                    % 7];
                            <th
                                abbr=(name)
                                scope="col"
                                class="h-8 text-xs font-normal text-muted-foreground"
                            >
                                (&name[..2])
                            </th>
                        }
                    </tr>
                </thead>
                <tbody>
                    #[key(row)]
                    for row in 0..6 {
                        <tr>
                            #[key(column)]
                            for column in 0..7 {
                                let day = CalendarDate::from_ordinal(
                                    grid_start + row * 7 + column,
                                );
                                if let Ok(day) = day {
                                    calendar_day(
                                        state: state.clone(),
                                        rules: rules.clone(),
                                        value: value.clone(),
                                        day: day,
                                        id: format!("{grid}-{}", day.ordinal()),
                                        first: first,
                                        last: last,
                                        version: version
                                    )
                                } else {
                                    <td></td>
                                }
                            }
                        </tr>
                    }
                </tbody>
            </table>
            if constraints.nearest(cursor).is_none() {
                <p role="status" class="mt-2 text-xs text-muted-foreground">
                    "No dates are available."
                </p>
            }
        </div>
    }.boxed())
}

#[component]
async fn month_button(
    cx: &Cx,
    state: CalendarState,
    command: &'static str,
    label: &'static str,
    boundary_disabled: bool,
) -> Result<impl View> {
    let reference = ElementRef::<HtmlElement>::new(element_id(cx));
    Ok(view! {
        <button
            id=(reference.id())
            type="button"
            aria-label=(label)
            :disabled=$(if state.disabled.get() { true } else { boundary_disabled })
            class="h-8 rounded-md px-2 text-xs hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
            @click=$(|_event: Event| {
                if !state.disabled.get() {
                    if !boundary_disabled {
                        if state.commands.get().len() < 256usize {
                            let button = reference.resolve();
                            if button.is_ok() {
                                let _focused = button.unwrap().focus(true);
                            }
                            state.wants_focus.set(false);
                            state.commands.push_str(command);
                            state.request.increment();
                        }
                    }
                }
            })
        >
            (if command == "p" { "Prev" } else { "Next" })
        </button>
    }.boxed())
}

#[component]
async fn calendar_day(
    state: CalendarState,
    rules: CalendarRules,
    value: DateRangeValue,
    day: CalendarDate,
    id: String,
    first: i32,
    last: i32,
    version: u64,
) -> Result<impl View> {
    let constraints = rules.constraints()?;
    let week = WeekStart::from_index(rules.week)?;
    let unavailable = constraints.validate_date(day).is_err();
    let iso = day.to_string();
    let ordinal = day.ordinal();
    let reference = ElementRef::<HtmlElement>::new(id.clone());
    let scroll = ScrollIntoViewOptions {
        block: ScrollAlignment::Nearest,
        inline: ScrollAlignment::Nearest,
        behavior: ScrollBehavior::Instant,
    };
    let focus = effect(expr!(|scope: EffectContext| {
        let active = state.cursor.get() == ordinal;
        let ready = state.accepted.get() == state.request.get();
        let requested = state.wants_focus.get();
        let open = state.open.get();
        if !state.disabled.get() {
            if active {
                if ready {
                    if requested {
                        if open {
                            scope.after_dom(|| {
                                if state.request.get() == version {
                                    if state.wants_focus.get() {
                                        if state.open.get() {
                                            let target = reference.resolve();
                                            if target.is_ok() {
                                                let day = target.unwrap();
                                                let _focused = day.focus(true);
                                                let _scrolled = day.scroll_into_view(scroll);
                                            }
                                            state.wants_focus.set(false);
                                        }
                                    }
                                }
                            });
                        }
                    }
                }
            }
        }
    }));
    let selection = state.selection.clone();
    let selected = expr!(if selection.is_range {
        let range = selection.range.get();
        if range.start == iso {
            true
        } else {
            if range.start < iso {
                if range.end >= iso { true } else { false }
            } else {
                false
            }
        }
    } else {
        selection.single.get() == iso
    });
    let range_start = expr!(if selection.is_range {
        selection.range.get().start == iso
    } else {
        false
    });
    let range_end = expr!(if selection.is_range {
        selection.range.get().end == iso
    } else {
        false
    });
    let label = day.label();
    let start_label = format!("{label}, range start");
    let end_label = format!("{label}, range end");
    let both_label = format!("{label}, range start and end");
    let commands = ["l", "r", "u", "d", "h", "e", "p", "n", "P", "N"].map(str::to_owned);
    let moves = ["l", "r", "u", "d", "h", "e", "p", "n", "P", "N"].map(|command| {
        constraints
            .clamp(day.navigate(command, week).expect("known command"))
            .ordinal()
    });
    let start = value.start;
    let end = value.end;
    let pending_start = start
        .parse::<CalendarDate>()
        .ok()
        .filter(|_| end.is_empty());
    let completes = selection.is_range && pending_start.is_some_and(|start| day >= start);
    let proposed_start = if completes {
        start.clone()
    } else {
        iso.clone()
    };
    let proposed_end = if completes {
        iso.clone()
    } else {
        String::new()
    };
    let rejected = if completes {
        constraints
            .validate_range(DateRange::new(pending_start.unwrap(), day)?)
            .err()
            .map(|error| error.to_string())
    } else {
        None
    };
    let rejection = rejected.unwrap_or_default();
    let current = expr!(if selection.is_range {
        if selection.range.get().start == start {
            selection.range.get().end == end
        } else {
            false
        }
    } else {
        selection.single.get() == start
    });
    Ok(view! {
        <td :aria-selected=$(if selected { "true" } else { "false" }) class="p-0">
            <button
                type="button"
                id=(id)
                data-date=(&iso)
                (focus)
                :aria-label=$(if range_start {
                    if range_end { both_label } else { start_label }
                } else {
                    if range_end { end_label } else { label }
                })
                aria-current=((ordinal == rules.today).then_some("date"))
                aria-disabled=(if unavailable { "true" } else { "false" })
                :disabled=$(state.disabled.get())
                :tabindex=$(if state.cursor.get() == ordinal { "0" } else { "-1" })
                :data-selected=$(selected)
                :data-range-start=$(range_start)
                :data-range-end=$(range_end)
                class=(class!(
                    "size-9 max-w-full rounded-md border border-transparent text-sm outline-none",
                    "hover:bg-foreground/5 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring",
                    "data-selected:bg-primary data-selected:text-primary-foreground" if !selection.is_range,
                    "[&[data-selected]:not([data-range-start]):not([data-range-end])]:bg-primary/15 data-range-start:bg-primary data-range-start:text-primary-foreground data-range-end:bg-primary data-range-end:text-primary-foreground" if selection.is_range,
                    "aria-[current=date]:font-bold aria-[current=date]:underline aria-[current=date]:underline-offset-4",
                    "aria-disabled:text-muted-foreground aria-disabled:line-through disabled:opacity-40",
                    "text-muted-foreground" if ordinal < first || ordinal > last,
                ))
                @focus=$(|_event: Event| {
                    if state.commands.get().is_empty() {
                        if state.cursor.get() != ordinal {
                            state.cursor.set(ordinal);
                        }
                    }
                })
                @click=$(|_event: Event| {
                    if !state.disabled.get() {
                        if !unavailable {
                            if state.request.get() == version {
                                if current {
                                    if rejection.is_empty() {
                                        state.notice.set("".to_owned());
                                        state.request.increment();
                                        if selection.is_range {
                                            selection.range.set(
                                                DateRangeValue { start: proposed_start, end: proposed_end },
                                            );
                                            if completes {
                                                state.close.set(true);
                                            }
                                        } else {
                                            selection.single.set(iso);
                                            state.close.set(true);
                                        }
                                    } else {
                                        state.notice.set(rejection);
                                    }
                                }
                            }
                        } else {
                            state.notice.set("This date is unavailable.".to_owned());
                        }
                    }
                })
                @keydown=$(|event: Event| {
                    let allowed = if event.is_composing {
                        false
                    } else {
                        if event.alt_key {
                            false
                        } else {
                            if event.ctrl_key { false } else { !event.meta_key }
                        }
                    };
                    if allowed {
                        if !state.disabled.get() {
                            let index = if event.key == "ArrowLeft" {
                                0usize
                            } else {
                                if event.key == "ArrowRight" {
                                    1usize
                                } else {
                                    if event.key == "ArrowUp" {
                                        2usize
                                    } else {
                                        if event.key == "ArrowDown" {
                                            3usize
                                        } else {
                                            if event.key == "Home" {
                                                4usize
                                            } else {
                                                if event.key == "End" {
                                                    5usize
                                                } else {
                                                    if event.key == "PageUp" {
                                                        if event.shift_key { 8usize } else { 6usize }
                                                    } else {
                                                        if event.key == "PageDown" {
                                                            if event.shift_key { 9usize } else { 7usize }
                                                        } else {
                                                            10usize
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            };
                            if index < 10usize {
                                event.prevent_default();
                                if state.commands.get().len() < 256usize {
                                    let target = *moves.index(index);
                                    let local = if state.commands.get().is_empty() {
                                        if target >= first { target <= last } else { false }
                                    } else {
                                        false
                                    };
                                    state.wants_focus.set(true);
                                    if local {
                                        state.cursor.set(target);
                                    } else {
                                        state.commands.push_str(commands.index(index).to_owned());
                                        state.request.increment();
                                    }
                                }
                            }
                        }
                    }
                })
            >
                (day.day())
            </button>
        </td>
    }.boxed())
}
