//! Gregorian dates and inclusive availability rules, evaluated on the server.

use std::{fmt, str::FromStr};

/// A Gregorian date without a time or timezone, from 0001-01-01 to 9999-12-31.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CalendarDate {
    year: u16,
    month: u8,
    day: u8,
}

impl CalendarDate {
    /// Constructs a date, rejecting invalid fields instead of normalizing them.
    ///
    /// # Errors
    /// Returns `InvalidDate` for an unsupported year, month, or day.
    pub fn new(year: u16, month: u8, day: u8) -> Result<Self, CalendarDateError> {
        if !(1..=9999).contains(&year) || !(1..=12).contains(&month) {
            return Err(CalendarDateError::InvalidDate);
        }
        let value = Self { year, month, day };
        if day == 0 || day > value.month_days() {
            return Err(CalendarDateError::InvalidDate);
        }
        Ok(value)
    }

    /// The four-digit year.
    #[must_use]
    pub fn year(self) -> u16 {
        self.year
    }

    /// The month, from 1 through 12.
    #[must_use]
    pub fn month(self) -> u8 {
        self.month
    }

    /// The day of the month, from 1 through 31.
    #[must_use]
    pub fn day(self) -> u8 {
        self.day
    }

    pub(super) const FIRST: Self = Self {
        year: 1,
        month: 1,
        day: 1,
    };
    pub(super) const LAST: Self = Self {
        year: 9999,
        month: 12,
        day: 31,
    };

    fn month_days(self) -> u8 {
        match self.month {
            4 | 6 | 9 | 11 => 30,
            2 if self.year.is_multiple_of(400)
                || (self.year.is_multiple_of(4) && !self.year.is_multiple_of(100)) =>
            {
                29
            }
            2 => 28,
            _ => 31,
        }
    }

    pub(super) fn first(self) -> Self {
        Self { day: 1, ..self }
    }

    pub(super) fn last(self) -> Self {
        Self {
            day: self.month_days(),
            ..self
        }
    }

    /// Zero-based days since Monday, 0001-01-01.
    pub(super) fn ordinal(self) -> i32 {
        let year = i32::from(self.year) - 1;
        let months: i32 = (1..self.month)
            .map(|month| i32::from(Self { month, ..self }.month_days()))
            .sum();
        year * 365 + year / 4 - year / 100 + year / 400 + months + i32::from(self.day) - 1
    }

    pub(super) fn from_ordinal(ordinal: i32) -> Result<Self, CalendarDateError> {
        if !(0..=Self::LAST.ordinal()).contains(&ordinal) {
            return Err(CalendarDateError::InvalidDate);
        }
        // Binary search the year, then inspect at most twelve months.
        let (mut low, mut high) = (1u16, 9999u16);
        while low < high {
            let mid = low + (high - low).div_ceil(2);
            if (Self {
                year: mid,
                month: 1,
                day: 1,
            })
            .ordinal()
                <= ordinal
            {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        let mut date = Self {
            year: low,
            month: 1,
            day: 1,
        };
        let mut remaining = ordinal - date.ordinal();
        while remaining >= i32::from(date.month_days()) {
            remaining -= i32::from(date.month_days());
            date.month += 1;
        }
        date.day = u8::try_from(remaining + 1).expect("a day fits in u8");
        Ok(date)
    }

    pub(super) fn add_days(self, days: i32) -> Self {
        Self::from_ordinal((self.ordinal() + days).clamp(0, Self::LAST.ordinal()))
            .expect("clamped ordinal")
    }

    pub(super) fn add_months(self, months: i32) -> Self {
        let index = (i32::from(self.year) - 1) * 12 + i32::from(self.month) - 1;
        let index = (index + months).clamp(0, 9999 * 12 - 1);
        let mut date = Self {
            year: u16::try_from(index / 12 + 1).expect("bounded year"),
            month: u8::try_from(index % 12 + 1).expect("bounded month"),
            day: self.day,
        };
        date.day = date.day.min(date.month_days());
        date
    }

    pub(super) fn week_offset(self, week: WeekStart) -> i32 {
        (self.ordinal() - i32::from(week as u8)).rem_euclid(7)
    }

    pub(super) fn navigate(
        self,
        commands: &str,
        week: WeekStart,
    ) -> Result<Self, CalendarDateError> {
        if commands.len() > 256 {
            return Err(CalendarDateError::InvalidNavigation);
        }
        commands.bytes().try_fold(self, |date, command| {
            Ok(match command {
                b'l' => date.add_days(-1),
                b'r' => date.add_days(1),
                b'u' => date.add_days(-7),
                b'd' => date.add_days(7),
                b'h' => date.add_days(-date.week_offset(week)),
                b'e' => date.add_days(6 - date.week_offset(week)),
                b'p' => date.add_months(-1),
                b'n' => date.add_months(1),
                b'P' => date.add_months(-12),
                b'N' => date.add_months(12),
                _ => return Err(CalendarDateError::InvalidNavigation),
            })
        })
    }

    fn month_name(self) -> &'static str {
        const MONTHS: [&str; 12] = [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ];
        MONTHS[usize::from(self.month - 1)]
    }

    pub(super) fn month_label(self) -> String {
        format!("{} {}", self.month_name(), self.year)
    }

    pub(super) fn label(self) -> String {
        format!(
            "{}, {} {}, {}",
            WeekStart::NAMES[usize::try_from(self.ordinal() % 7).expect("nonnegative weekday")],
            self.month_name(),
            self.day,
            self.year
        )
    }
}

impl fmt::Display for CalendarDate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }
}

impl FromStr for CalendarDate {
    type Err = CalendarDateError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let bytes = value.as_bytes();
        if bytes.len() != 10
            || bytes[4] != b'-'
            || bytes[7] != b'-'
            || !bytes
                .iter()
                .enumerate()
                .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
        {
            return Err(CalendarDateError::InvalidDate);
        }
        Self::new(
            value[..4]
                .parse()
                .map_err(|_| CalendarDateError::InvalidDate)?,
            value[5..7]
                .parse()
                .map_err(|_| CalendarDateError::InvalidDate)?,
            value[8..]
                .parse()
                .map_err(|_| CalendarDateError::InvalidDate)?,
        )
    }
}

/// An inclusive date range with ordered endpoints.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DateRange {
    start: CalendarDate,
    end: CalendarDate,
}

impl DateRange {
    /// Constructs a range. Equal endpoints select one day.
    ///
    /// # Errors
    /// Returns `ReversedRange` when the start follows the end.
    pub fn new(start: CalendarDate, end: CalendarDate) -> Result<Self, CalendarDateError> {
        if start > end {
            return Err(CalendarDateError::ReversedRange);
        }
        Ok(Self { start, end })
    }

    /// The first included date.
    #[must_use]
    pub fn start(self) -> CalendarDate {
        self.start
    }

    /// The last included date.
    #[must_use]
    pub fn end(self) -> CalendarDate {
        self.end
    }

    fn intersects(self, other: Self) -> bool {
        self.start <= other.end && other.start <= self.end
    }
}

/// Inclusive bounds and unavailable dates, checked on the server.
#[derive(Clone, Debug, Default)]
pub struct DateConstraints {
    pub min: Option<CalendarDate>,
    pub max: Option<CalendarDate>,
    pub disabled_dates: Vec<CalendarDate>,
    pub disabled_ranges: Vec<DateRange>,
}

impl DateConstraints {
    /// Checks that the configured bounds are ordered.
    ///
    /// # Errors
    /// Returns `ReversedRange` when the minimum follows the maximum.
    pub fn validate(&self) -> Result<(), CalendarDateError> {
        if self.minimum() > self.maximum() {
            Err(CalendarDateError::ReversedRange)
        } else {
            Ok(())
        }
    }

    /// Checks one date against inclusive bounds and unavailable dates.
    ///
    /// # Errors
    /// Returns an error for invalid bounds or an unavailable/out-of-bounds date.
    pub fn validate_date(&self, date: CalendarDate) -> Result<(), CalendarDateError> {
        self.validate_range(DateRange {
            start: date,
            end: date,
        })
    }

    /// Checks the whole inclusive span, including unavailable interior dates.
    ///
    /// # Errors
    /// Returns an error for invalid bounds, an out-of-bounds endpoint, or an
    /// unavailable date anywhere in the span.
    pub fn validate_range(&self, range: DateRange) -> Result<(), CalendarDateError> {
        self.validate()?;
        if range.start < self.minimum() || range.end > self.maximum() {
            return Err(CalendarDateError::OutsideBounds);
        }
        if self
            .disabled_dates
            .iter()
            .any(|day| range.start <= *day && *day <= range.end)
            || self
                .disabled_ranges
                .iter()
                .any(|disabled| range.intersects(*disabled))
        {
            return Err(CalendarDateError::Unavailable);
        }
        Ok(())
    }

    pub(super) fn minimum(&self) -> CalendarDate {
        self.min.unwrap_or(CalendarDate::FIRST)
    }
    pub(super) fn maximum(&self) -> CalendarDate {
        self.max.unwrap_or(CalendarDate::LAST)
    }

    pub(super) fn clamp(&self, date: CalendarDate) -> CalendarDate {
        date.clamp(self.minimum(), self.maximum())
    }

    pub(super) fn navigate(
        &self,
        date: CalendarDate,
        commands: &str,
        week: WeekStart,
    ) -> Result<CalendarDate, CalendarDateError> {
        if commands.len() > 256 || !commands.is_ascii() {
            return Err(CalendarDateError::InvalidNavigation);
        }
        (0..commands.len()).try_fold(date, |date, index| {
            Ok(self.clamp(date.navigate(&commands[index..=index], week)?))
        })
    }

    pub(super) fn nearest(&self, date: CalendarDate) -> Option<CalendarDate> {
        let date = self.clamp(date);
        // Jump over blocked intervals instead of traversing a long disabled span.
        let blocked = self
            .disabled_ranges
            .iter()
            .copied()
            .chain(self.disabled_dates.iter().map(|day| DateRange {
                start: *day,
                end: *day,
            }))
            .collect::<Vec<_>>();
        let seek = |forward: bool| {
            let mut candidate = date;
            loop {
                let Some(range) = blocked
                    .iter()
                    .find(|range| range.start <= candidate && candidate <= range.end)
                else {
                    return Some(candidate);
                };
                let next = if forward {
                    range.end.add_days(1)
                } else {
                    range.start.add_days(-1)
                };
                if next == candidate || next < self.minimum() || next > self.maximum() {
                    return None;
                }
                candidate = next;
            }
        };
        match (seek(true), seek(false)) {
            (Some(next), Some(previous)) => Some(
                if next.ordinal() - date.ordinal() <= date.ordinal() - previous.ordinal() {
                    next
                } else {
                    previous
                },
            ),
            (next, previous) => next.or(previous),
        }
    }
}

/// The first column of a calendar week. Monday is the default.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u8)]
pub enum WeekStart {
    #[default]
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

impl WeekStart {
    pub(super) const NAMES: [&str; 7] = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
    ];

    pub(super) fn from_index(index: u8) -> Result<Self, CalendarDateError> {
        match index {
            0 => Ok(Self::Monday),
            1 => Ok(Self::Tuesday),
            2 => Ok(Self::Wednesday),
            3 => Ok(Self::Thursday),
            4 => Ok(Self::Friday),
            5 => Ok(Self::Saturday),
            6 => Ok(Self::Sunday),
            _ => Err(CalendarDateError::InvalidNavigation),
        }
    }
}

/// A date, range, or calendar request that cannot be accepted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarDateError {
    InvalidDate,
    ReversedRange,
    OutsideBounds,
    Unavailable,
    InvalidNavigation,
}

impl fmt::Display for CalendarDateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidDate => "Enter a real date as YYYY-MM-DD.",
            Self::ReversedRange => "The end date must be on or after the start date.",
            Self::OutsideBounds => "Choose a date within the allowed bounds.",
            Self::Unavailable => "The selection includes an unavailable date.",
            Self::InvalidNavigation => "The calendar navigation request is invalid.",
        })
    }
}

impl std::error::Error for CalendarDateError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(value: &str) -> CalendarDate {
        value.parse().unwrap()
    }

    #[test]
    fn strict_dates_and_century_leap_rules() {
        for value in ["0001-01-01", "2000-02-29", "2024-02-29", "9999-12-31"] {
            assert_eq!(date(value).to_string(), value);
        }
        for value in [
            "0000-01-01",
            "1900-02-29",
            "2100-02-29",
            "2025-02-29",
            "2026-04-31",
            "2026-13-01",
            "2026-00-01",
            "2026-01-00",
            "2026-1-01",
            " 2026-01-01",
            "2026-01-01T00:00:00Z",
            "2026-01-01+01:00",
            "\u{ff12}\u{ff10}\u{ff12}\u{ff16}-01-01",
        ] {
            assert!(value.parse::<CalendarDate>().is_err(), "{value}");
        }
    }

    #[test]
    fn ordinal_round_trips_over_a_gregorian_cycle() {
        let start = date("2000-01-01").ordinal();
        for ordinal in start..start + 146_097 {
            assert_eq!(
                CalendarDate::from_ordinal(ordinal).unwrap().ordinal(),
                ordinal
            );
        }
        assert_eq!(CalendarDate::from_ordinal(0).unwrap(), date("0001-01-01"));
        assert_eq!(
            CalendarDate::from_ordinal(3_652_058).unwrap(),
            date("9999-12-31")
        );
        assert!(CalendarDate::from_ordinal(-1).is_err());
        assert!(CalendarDate::from_ordinal(3_652_059).is_err());
    }

    #[test]
    fn navigation_clamps_each_step_and_crosses_boundaries() {
        for (from, command, to) in [
            ("2024-01-31", "n", "2024-02-29"),
            ("2024-01-31", "nn", "2024-03-29"),
            ("2024-02-29", "N", "2025-02-28"),
            ("2025-12-31", "r", "2026-01-01"),
            ("2026-01-01", "l", "2025-12-31"),
            ("2026-01-31", "nru", "2026-02-22"),
            ("0001-01-01", "lP", "0001-01-01"),
            ("9999-12-31", "rN", "9999-12-31"),
        ] {
            assert_eq!(
                date(from).navigate(command, WeekStart::Monday).unwrap(),
                date(to)
            );
        }
        assert!(date("2026-01-01").navigate("x", WeekStart::Monday).is_err());
        assert!(
            date("2026-01-01")
                .navigate(&"r".repeat(257), WeekStart::Monday)
                .is_err()
        );
    }

    #[test]
    fn queued_navigation_clamps_bounds_at_each_step() {
        let rules = DateConstraints {
            min: Some(date("2024-01-01")),
            max: Some(date("2024-02-20")),
            ..Default::default()
        };
        assert_eq!(
            rules
                .navigate(date("2024-01-31"), "nnp", WeekStart::Monday)
                .unwrap(),
            date("2024-01-20")
        );
        assert!(
            rules
                .navigate(date("2024-01-31"), "x", WeekStart::Monday)
                .is_err()
        );
        assert!(
            rules
                .navigate(date("2024-01-31"), "\u{e9}", WeekStart::Monday)
                .is_err()
        );
    }

    #[test]
    fn every_week_start_controls_home_and_end() {
        // 2026-10-15 is Thursday. The preceding Monday is October 12.
        for (index, first) in [12, 13, 14, 15, 9, 10, 11].into_iter().enumerate() {
            let week = WeekStart::from_index(u8::try_from(index).unwrap()).unwrap();
            let start = CalendarDate::new(2026, 10, first).unwrap();
            assert_eq!(date("2026-10-15").navigate("h", week).unwrap(), start);
            assert_eq!(
                date("2026-10-15").navigate("e", week).unwrap(),
                start.add_days(6)
            );
        }
    }

    #[test]
    fn spans_reject_disabled_interiors_and_include_endpoints() {
        let rules = DateConstraints {
            min: Some(date("2026-01-01")),
            max: Some(date("2026-12-31")),
            disabled_dates: vec![date("2026-02-10")],
            disabled_ranges: vec![DateRange::new(date("2026-03-10"), date("2026-03-20")).unwrap()],
        };
        assert!(rules.validate_date(date("2026-01-01")).is_ok());
        assert!(rules.validate_date(date("2026-12-31")).is_ok());
        assert!(rules.validate_date(date("2025-12-31")).is_err());
        assert!(
            rules
                .validate_range(DateRange::new(date("2026-02-01"), date("2026-02-28")).unwrap())
                .is_err()
        );
        assert!(rules.validate_date(date("2026-03-20")).is_err());
        assert!(DateRange::new(date("2026-02-02"), date("2026-02-01")).is_err());
        assert!(
            rules
                .validate_range(DateRange::new(date("2026-02-01"), date("2026-02-01")).unwrap())
                .is_ok()
        );
    }

    #[test]
    fn eligible_fallback_jumps_over_overlapping_intervals() {
        let rules = DateConstraints {
            min: Some(date("2026-01-01")),
            max: Some(date("2026-01-10")),
            disabled_dates: vec![date("2026-01-05")],
            disabled_ranges: vec![
                DateRange::new(date("2026-01-01"), date("2026-01-03")).unwrap(),
                DateRange::new(date("2026-01-03"), date("2026-01-04")).unwrap(),
            ],
        };
        assert_eq!(rules.nearest(date("2026-01-02")), Some(date("2026-01-06")));
        let none = DateConstraints {
            disabled_ranges: vec![DateRange::new(CalendarDate::FIRST, CalendarDate::LAST).unwrap()],
            ..Default::default()
        };
        assert_eq!(none.nearest(date("2026-01-02")), None);
        let invalid = DateConstraints {
            min: Some(date("2026-02-01")),
            max: Some(date("2026-01-01")),
            ..Default::default()
        };
        assert!(invalid.validate().is_err());
    }
}
