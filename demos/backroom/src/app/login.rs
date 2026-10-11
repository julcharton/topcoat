//! Signing in, and the guard that sends signed-out visitors here.

use serde::Deserialize;
use topcoat::{
    Result,
    context::{Cx, try_request_context},
    icon::{icon, iconify::iconify_icon},
    router::{
        Body, Method, StatusCode,
        content::Form,
        error::{RouterErrorExt, SeeOther, redirect, rewrite, see_other},
        href, page, route,
    },
    view::{View, attributes, element_id, view},
};

use crate::{
    components::{
        alert::{AlertVariant, alert, alert_description, alert_title},
        badge::{BadgeVariant, badge},
        button::button,
        card::{card, card_content, card_description, card_footer, card_header, card_title},
        field::{field, field_group, field_label},
        input::input,
    },
    features::{
        auth::{current_user, sign_in},
        user::User,
    },
    seed::{DEMO_PASSWORD, DEMO_USERS},
};

/// Returns the signed-in user, or redirects to the sign-in page.
///
/// Call it in every page, shard, and procedure that needs a user. It is cheap to call
/// repeatedly because [`current_user`] is memoized.
pub async fn require_user(cx: &Cx) -> Result<&User> {
    let user = current_user(cx).await?;
    Ok(user.as_ref().ok_or_redirect(href!(page).resolve(cx))?)
}

/// Tells the sign-in page that the submitted email and password did not match.
struct SignInFailed {
    email: String,
}

#[page]
pub async fn page(cx: &Cx) -> Result<impl View> {
    if current_user(cx).await?.is_some() {
        return Err(redirect(href!(super::_admin::page).resolve(cx)).into());
    }

    let failed = try_request_context::<SignInFailed>(cx);
    let email = failed.map(|failed| failed.email.as_str());

    // IDs that connect the labels to their inputs and the button to its form.
    let form_id = element_id(cx);
    let email_id = element_id(cx);
    let password_id = element_id(cx);

    Ok(view! {
        if failed.is_some() {
            (StatusCode::UNPROCESSABLE_ENTITY)
        }

        <main class="flex min-h-svh flex-col items-center justify-center gap-6 p-6">
            <p class="flex items-center gap-2 text-lg font-semibold">
                icon(data: iconify_icon!("lucide:store"))
                "Backroom"
            </p>

            card(
                attrs: attributes! { class="w-full max-w-sm" },
                card_header(
                    card_title("Sign in")
                    card_description("Use your staff account to manage the store.")
                )
                card_content(
                    <form id=(&form_id) method="post" action=(href!(submit))>
                        field_group(
                            if failed.is_some() {
                                alert(
                                    variant: AlertVariant::Destructive,
                                    icon(data: iconify_icon!("lucide:circle-alert"))
                                    alert_title("Wrong email or password")
                                    alert_description("Check your details and try again.")
                                )
                            }
                            field(
                                field_label(
                                    attrs: attributes! { for=(&email_id) },
                                    "Email"
                                )
                                input(
                                    attrs: attributes! {
                                        id=(&email_id)
                                        name="email"
                                        type="email"
                                        autocomplete="username"
                                        required=""
                                        value=(email)
                                    }
                                )
                            )
                            field(
                                field_label(
                                    attrs: attributes! { for=(&password_id) },
                                    "Password"
                                )
                                input(
                                    attrs: attributes! {
                                        id=(&password_id)
                                        name="password"
                                        type="password"
                                        autocomplete="current-password"
                                        required=""
                                    }
                                )
                            )
                        )
                    </form>
                )
                card_footer(
                    button(
                        attrs: attributes! { type="submit" form=(&form_id) class="w-full" },
                        "Sign in"
                    )
                )
            )

            demo_accounts()
        </main>
    })
}

/// Lists the seeded accounts, so visitors can try each role.
#[topcoat::view::component]
async fn demo_accounts() -> Result<impl View> {
    Ok(view! {
        card(
            attrs: attributes! { class="w-full max-w-sm" },
            card_header(
                card_title("Demo accounts")
                card_description(
                    "Every account uses the password "
                    <code class="font-mono text-foreground">(DEMO_PASSWORD)</code>
                    "."
                )
            )
            card_content(
                <ul class="flex flex-col gap-3 text-sm">
                    for (name, email, role) in DEMO_USERS {
                        <li class="flex items-center justify-between gap-4">
                            <div class="flex flex-col">
                                <span class="font-medium">(name)</span>
                                <span class="text-muted-foreground">(email)</span>
                            </div>
                            badge(variant: BadgeVariant::Outline, (role.label()))
                        </li>
                    }
                </ul>
            )
        )
    })
}

#[derive(Deserialize)]
struct Credentials {
    email: String,
    password: String,
}

/// Signs in with an email and password, or shows the form again with an error.
#[route(POST)]
async fn submit(cx: &Cx, Form(credentials): Form<Credentials>) -> Result<SeeOther> {
    let Credentials { email, password } = credentials;

    let Some(user) = User::authenticate(cx, &email, password).await? else {
        // Render the sign-in page in response to this POST, without a redirect, so
        // it can show the error next to the submitted email.
        return Err(rewrite(href!(page).resolve(cx), Body::empty())
            .method(Method::GET)
            .with(SignInFailed { email })
            .into());
    };

    sign_in(cx, &user).await?;
    Ok(see_other(href!(super::_admin::page).resolve(cx)))
}
