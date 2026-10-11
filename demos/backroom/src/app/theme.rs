use serde::Deserialize;
use topcoat::{
    Result,
    context::Cx,
    router::{
        content::Form,
        error::{SeeOther, see_other},
        href, route,
    },
};

use crate::features::theme::toggle_theme;

#[derive(Deserialize)]
pub struct Toggle {
    /// The path of the page the toggle was on.
    return_to: String,
}

/// Switches between the light and dark themes, then reloads the page the toggle was on.
#[route(POST)]
pub async fn toggle(cx: &Cx, Form(form): Form<Toggle>) -> Result<SeeOther> {
    toggle_theme(cx)?;

    // The path comes from the client. Only follow paths on this site, so the form
    // cannot be used to send someone elsewhere.
    let local = form.return_to.starts_with('/')
        && !form.return_to.starts_with("//")
        && !form.return_to.contains('\\');
    if local {
        Ok(see_other(form.return_to))
    } else {
        Ok(see_other(href!(super::_admin::page).resolve(cx)))
    }
}
