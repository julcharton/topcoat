//! The color theme, remembered per browser in a cookie.

use serde::{Deserialize, Serialize};
use topcoat::{
    Result,
    context::Cx,
    cookie::{Cookies, SameSite, UnparsedCookieStore, cookie_store, cookies, time::Duration},
};

/// The color theme pages render in.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Light,
    Dark,
}

impl Theme {
    /// The class that selects the theme's colors, set on an ancestor of the page.
    pub fn class(self) -> Option<&'static str> {
        match self {
            Self::Light => None,
            Self::Dark => Some("dark"),
        }
    }

    /// The `color-scheme` style, so native controls and scrollbars match the theme.
    pub fn color_scheme(self) -> &'static str {
        match self {
            Self::Light => "color-scheme: light",
            Self::Dark => "color-scheme: dark",
        }
    }

    /// The other theme.
    #[must_use]
    pub fn toggled(self) -> Self {
        match self {
            Self::Light => Self::Dark,
            Self::Dark => Self::Light,
        }
    }
}

/// The theme the browser chose, or the light theme if it has not chosen one.
pub fn theme(cx: &Cx) -> Theme {
    store(cx).parse_or_default().get()
}

/// Switches the browser between the light and dark themes. Returns the new theme.
pub fn toggle_theme(cx: &Cx) -> Result<Theme> {
    let theme = store(cx)
        .parse_or_default()
        .update(|theme| *theme = theme.toggled())
        .commit()?;
    Ok(theme)
}

/// The cookie holding the theme, kept for a year on every path.
fn store(cx: &Cx) -> UnparsedCookieStore<Theme, impl Cookies> {
    let jar = cookies(cx)
        .default_path("/")
        .default_http_only(true)
        .default_same_site(SameSite::Lax)
        .default_max_age(Duration::days(365));
    cookie_store(jar, "theme")
}
