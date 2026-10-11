use topcoat::{
    Result,
    context::Cx,
    router::{
        error::{SeeOther, see_other},
        href, route,
    },
};

use crate::features::auth::sign_out;

/// Ends the session and returns to the sign-in page.
#[route(POST)]
pub async fn submit(cx: &Cx) -> Result<SeeOther> {
    sign_out(cx).await?;
    Ok(see_other(href!(super::login::page).resolve(cx)))
}
