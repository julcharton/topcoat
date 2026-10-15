//! Shared state for the calendar and its form wrappers.

use topcoat::{
    context::Cx,
    runtime::{Expr, Signal, expr, record, signal},
};

use super::calendar_date::{
    CalendarDate, CalendarDateError, DateConstraints, DateRange, WeekStart,
};

/// Editable ISO date drafts. An empty string means an unfilled endpoint.
///
/// Replace the pair through one signal so observers see both endpoints together.
/// Validate the strings on the server before using them as dates.
#[record]
#[derive(Clone, Debug, Default)]
pub struct DateRangeValue {
    pub start: String,
    pub end: String,
}

/// The caller-owned selection displayed and edited by a calendar.
#[derive(Clone)]
pub enum CalendarSelection {
    Single(Signal<String>),
    Range(Signal<DateRangeValue>),
}

#[record]
#[derive(Clone)]
pub(super) struct Selection {
    pub single: Signal<String>,
    pub range: Signal<DateRangeValue>,
    pub is_range: bool,
}

impl Selection {
    fn new(cx: &Cx, selection: CalendarSelection) -> Self {
        // Both call sites have stable identities, independent of the selection mode.
        let single = signal(cx, String::new);
        let range = signal(cx, DateRangeValue::default);
        match selection {
            CalendarSelection::Single(single) => Self {
                single,
                range,
                is_range: false,
            },
            CalendarSelection::Range(range) => Self {
                single,
                range,
                is_range: true,
            },
        }
    }

    /// One acceptance predicate for rendered and validated selection snapshots.
    pub fn matches(&self, start: &Expr<String>, end: &Expr<String>) -> Expr<bool> {
        let start = start.clone();
        let end = end.clone();
        let single = self.single.clone();
        let range = self.range.clone();
        if self.is_range {
            expr!({
                let value = range.get();
                if value.start == start {
                    value.end == end
                } else {
                    false
                }
            })
        } else {
            expr!(single.get() == start)
        }
    }

    pub fn read(&self, tracked: bool) -> DateRangeValue {
        if self.is_range {
            if tracked {
                self.range.get()
            } else {
                self.range.get_untracked()
            }
        } else {
            DateRangeValue {
                start: if tracked {
                    self.single.get()
                } else {
                    self.single.get_untracked()
                },
                end: String::new(),
            }
        }
    }
}

/// Serializable date facts. Every request reconstructs and checks the domain rules.
#[record]
#[derive(Clone)]
pub(super) struct CalendarRules {
    pub min: i32,
    pub max: i32,
    pub blocked: Vec<(i32, i32)>,
    pub today: i32,
    pub week: u8,
}

impl CalendarRules {
    pub fn new(
        today: CalendarDate,
        week: WeekStart,
        constraints: &DateConstraints,
    ) -> Result<Self, CalendarDateError> {
        constraints.validate()?;
        Ok(Self {
            min: constraints.minimum().ordinal(),
            max: constraints.maximum().ordinal(),
            blocked: constraints
                .disabled_ranges
                .iter()
                .map(|range| (range.start().ordinal(), range.end().ordinal()))
                .chain(
                    constraints
                        .disabled_dates
                        .iter()
                        .map(|date| (date.ordinal(), date.ordinal())),
                )
                .collect(),
            today: today.ordinal(),
            week: week as u8,
        })
    }

    pub fn constraints(&self) -> Result<DateConstraints, CalendarDateError> {
        CalendarDate::from_ordinal(self.today)?;
        WeekStart::from_index(self.week)?;
        if self.blocked.len() > 4096 {
            return Err(CalendarDateError::InvalidNavigation);
        }
        let rules = DateConstraints {
            min: Some(CalendarDate::from_ordinal(self.min)?),
            max: Some(CalendarDate::from_ordinal(self.max)?),
            disabled_dates: Vec::new(),
            disabled_ranges: self
                .blocked
                .iter()
                .map(|(start, end)| {
                    DateRange::new(
                        CalendarDate::from_ordinal(*start)?,
                        CalendarDate::from_ordinal(*end)?,
                    )
                })
                .collect::<Result<_, _>>()?,
        };
        rules.validate()?;
        Ok(rules)
    }

    pub fn opening(
        &self,
        value: &DateRangeValue,
        constraints: &DateConstraints,
    ) -> Result<CalendarDate, CalendarDateError> {
        let today = CalendarDate::from_ordinal(self.today)?;
        Ok(value
            .start
            .parse()
            .ok()
            .filter(|date| constraints.validate_date(*date).is_ok())
            .or_else(|| constraints.nearest(today))
            .unwrap_or_else(|| constraints.clamp(today)))
    }

    pub fn initial(
        &self,
        value: &DateRangeValue,
        month: Option<CalendarDate>,
    ) -> Result<CalendarDate, CalendarDateError> {
        let constraints = self.constraints()?;
        let opening = self.opening(value, &constraints)?;
        if let Some(month) = month {
            Ok(constraints.clamp(CalendarDate::new(
                month.year(),
                month.month(),
                opening.day().min(month.last().day()),
            )?))
        } else {
            Ok(opening)
        }
    }

    pub fn error(
        &self,
        value: &DateRangeValue,
        is_range: bool,
        required: bool,
    ) -> Result<String, CalendarDateError> {
        let constraints = self.constraints()?;
        if value.start.is_empty() && (!is_range || value.end.is_empty()) {
            return Ok(if required {
                "Choose a date.".to_owned()
            } else {
                String::new()
            });
        }
        if is_range && (value.start.is_empty() || value.end.is_empty()) {
            return Ok("Choose both a start and an end date.".to_owned());
        }
        let validation = value.start.parse::<CalendarDate>().and_then(|start| {
            if is_range {
                let end = value.end.parse()?;
                constraints.validate_range(DateRange::new(start, end)?)
            } else {
                constraints.validate_date(start)
            }
        });
        Ok(validation
            .err()
            .map_or_else(String::new, |error| error.to_string()))
    }
}

#[record]
#[derive(Clone)]
pub(super) struct CalendarState {
    pub selection: Selection,
    pub cursor: Signal<i32>,
    pub commands: Signal<String>,
    pub request: Signal<u64>,
    pub accepted: Signal<u64>,
    pub wants_focus: Signal<bool>,
    pub disabled: Signal<bool>,
    pub open: Signal<bool>,
    pub close: Signal<bool>,
    pub notice: Signal<String>,
}

impl CalendarState {
    pub fn new(
        cx: &Cx,
        selection: CalendarSelection,
        rules: &CalendarRules,
        initial_month: Option<CalendarDate>,
        open: bool,
        disabled: bool,
    ) -> Result<Self, CalendarDateError> {
        let selection = Selection::new(cx, selection);
        let initial = rules.initial(&selection.read(false), initial_month)?;
        Ok(Self {
            selection,
            cursor: signal(cx, || initial.ordinal()),
            commands: signal(cx, String::new),
            request: signal(cx, || 0u64),
            accepted: signal(cx, || 0u64),
            wants_focus: signal(cx, || false),
            disabled: signal(cx, || disabled),
            open: signal(cx, || open),
            close: signal(cx, || false),
            notice: signal(cx, String::new),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(value: &str) -> CalendarDate {
        value.parse().unwrap()
    }

    #[test]
    fn restored_rule_facts_are_checked() {
        let rules = CalendarRules::new(
            date("2024-01-31"),
            WeekStart::Monday,
            &DateConstraints::default(),
        )
        .unwrap();
        for invalid in [
            CalendarRules {
                today: -1,
                ..rules.clone()
            },
            CalendarRules {
                week: 7,
                ..rules.clone()
            },
            CalendarRules {
                min: rules.max,
                max: 0,
                ..rules.clone()
            },
            CalendarRules {
                blocked: vec![(2, 1)],
                ..rules.clone()
            },
            CalendarRules {
                blocked: vec![(0, 0); 4097],
                ..rules.clone()
            },
        ] {
            assert!(invalid.constraints().is_err());
        }
    }

    #[test]
    fn opening_and_reset_use_explicit_values_without_timezones() {
        let rules = CalendarRules::new(
            date("2024-02-11"),
            WeekStart::Monday,
            &DateConstraints {
                disabled_ranges: vec![
                    DateRange::new(date("2024-02-10"), date("2024-02-12")).unwrap(),
                ],
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            rules.initial(&DateRangeValue::default(), None).unwrap(),
            date("2024-02-13")
        );
        let selected = DateRangeValue {
            start: "2024-01-31".to_owned(),
            end: String::new(),
        };
        assert_eq!(
            rules.initial(&selected, Some(date("2024-02-01"))).unwrap(),
            date("2024-02-29")
        );
        assert_ne!(rules.error(&selected, true, false).unwrap(), "");
        assert_eq!(
            rules
                .error(&DateRangeValue::default(), true, false)
                .unwrap(),
            ""
        );
        assert_ne!(
            rules.error(&DateRangeValue::default(), true, true).unwrap(),
            ""
        );
    }
}
