//! The back office for signed-in staff.
//!
//! The leading underscore makes this module a group: its layout wraps every page
//! below it without adding a segment to their URLs.

use topcoat::{
    Result,
    context::Cx,
    icon::{IconData, icon, iconify::iconify_icon},
    router::{HrefTarget, Slot, href, layout, page, request::uri},
    runtime::{Event, Signal, link, signal},
    view::{View, attributes, component, element_id, view},
};

use super::{login::require_user, logout};
use crate::{
    components::{
        avatar::{AvatarSize, avatar, avatar_fallback},
        breadcrumb::{
            breadcrumb, breadcrumb_item, breadcrumb_list, breadcrumb_page, breadcrumb_separator,
        },
        button::{ButtonSize, ButtonVariant, button},
        dropdown_menu::{
            dropdown_menu, dropdown_menu_content, dropdown_menu_item, dropdown_menu_label,
            dropdown_menu_separator, dropdown_menu_trigger,
        },
        floating::{FloatingAlign, FloatingSide},
        separator::{SeparatorOrientation, separator},
        sidebar::{
            SidebarCollapsible, SidebarMenuButtonSize, SidebarMenuButtonVariant, sidebar,
            sidebar_content, sidebar_footer, sidebar_group, sidebar_group_content,
            sidebar_group_label, sidebar_header, sidebar_inset, sidebar_menu,
            sidebar_menu_button_variants, sidebar_menu_item, sidebar_provider, sidebar_trigger,
        },
    },
    features::{
        theme::{Theme, theme},
        user::User,
    },
};

/// A page in the sidebar's navigation.
struct NavItem {
    label: &'static str,
    icon: IconData,
    target: &'static (dyn HrefTarget + Sync),
}

/// The sidebar's navigation, in display order.
static NAV: [NavItem; 1] = [NavItem {
    label: "Dashboard",
    icon: iconify_icon!("lucide:layout-dashboard"),
    target: &page,
}];

#[layout]
async fn shell(cx: &Cx, slot: Slot<'_>) -> Result<impl View> {
    let user = require_user(cx).await?;

    let open = signal(cx, || true);
    let mobile_open = signal(cx, || false);
    let sidebar_id = element_id(cx);

    Ok(view! {
        sidebar_provider(
            app_sidebar(
                id: &sidebar_id,
                user: user,
                open: &open,
                mobile_open: &mobile_open
            )
            sidebar_inset(
                sidebar_header(
                    sidebar_trigger(
                        open: $(open.get()),
                        attrs: attributes! {
                            class="max-md:hidden"
                            aria-controls=(&sidebar_id)
                            @click=$(|_e: Event| open.toggle())
                        }
                    )
                    sidebar_trigger(
                        open: $(mobile_open.get()),
                        attrs: attributes! {
                            class="md:hidden"
                            aria-controls=(&sidebar_id)
                            @click=$(|_e: Event| mobile_open.toggle())
                        }
                    )
                    separator(orientation: SeparatorOrientation::Vertical)
                    page_breadcrumb()
                    theme_toggle()
                )
                <div class="flex flex-1 flex-col gap-6 p-6">(slot)</div>
            )
        )
    })
}

/// The navigation sidebar, with the signed-in user at the bottom.
#[component]
async fn app_sidebar(
    cx: &Cx,
    id: &str,
    user: &User,
    open: &Signal<bool>,
    mobile_open: &Signal<bool>,
) -> Result<impl View> {
    Ok(view! {
        sidebar(
            open: $(open.get()),
            mobile_open: $(mobile_open.get()),
            collapsible: SidebarCollapsible::Icon,
            sheet_attrs: attributes! {
                id=(id)
                aria-label="Back office navigation"
                @keydown=$(|e: Event| {
                    if e.key == "Escape" {
                        mobile_open.set(false);
                    }
                })
                @click=$(|e: Event| {
                    // A click on the backdrop targets the sheet itself.
                    if e.target.id == id {
                        mobile_open.set(false);
                    }
                })
            },
            sidebar_header(
                <div class="flex items-center gap-1">
                    <div
                        class=(sidebar_menu_button_variants(
                            SidebarMenuButtonVariant::Default,
                            SidebarMenuButtonSize::Lg,
                        ))
                    >
                        icon(data: iconify_icon!("lucide:store"))
                        <span class="font-semibold">"Backroom"</span>
                    </div>
                    button(
                        variant: ButtonVariant::Ghost,
                        size: ButtonSize::Icon,
                        attrs: attributes! {
                            type="button"
                            class="md:hidden"
                            aria-label="Close sidebar"
                            @click=$(|_e: Event| mobile_open.set(false))
                        },
                        icon(data: iconify_icon!("lucide:x"))
                    )
                </div>
            )
            sidebar_content(
                sidebar_group(
                    sidebar_group_label("Store")
                    sidebar_group_content(
                        sidebar_menu(
                            for item in &NAV {
                                let href = href!(item.target);
                                let current = href.is_current(cx);
                                sidebar_menu_item(
                                    // `link` opens the page without a full reload. The
                                    // sidebar's class helper gives it the menu's look.
                                    link(
                                        href: href,
                                        attrs: attributes! {
                                            data-sidebar="menu-button"
                                            data-active=(if current { "true" } else { "false" })
                                            aria-current=(current.then_some("page"))
                                            title=(item.label)
                                            class=(sidebar_menu_button_variants(
                                                SidebarMenuButtonVariant::Default,
                                                SidebarMenuButtonSize::Md,
                                            ))
                                            @click=$(|_e: Event| mobile_open.set(false))
                                        },
                                        icon(data: item.icon.clone())
                                        <span>(item.label)</span>
                                    )
                                )
                            }
                        )
                    )
                )
            )
            sidebar_footer(sidebar_menu(sidebar_menu_item(user_menu(user: user))))
        )
    })
}

/// The signed-in user, opening a menu with their account details and signing out.
#[component]
async fn user_menu(cx: &Cx, user: &User) -> Result<impl View> {
    let menu = element_id(cx);

    Ok(view! {
        dropdown_menu(
            dropdown_menu_trigger(
                target: &menu,
                attrs: attributes! {
                    title=(&user.name)
                    class=(sidebar_menu_button_variants(
                        SidebarMenuButtonVariant::Default,
                        SidebarMenuButtonSize::Lg,
                    ))
                },
                avatar(size: AvatarSize::Sm, avatar_fallback((user.initials())))
                // The sidebar hides the last `<span>` when it collapses to icons.
                <span class="flex min-w-0 flex-1 items-center gap-2">
                    <span class="flex min-w-0 flex-col">
                        <span class="truncate font-medium">(&user.name)</span>
                        <span class="truncate text-xs text-muted-foreground">
                            (user.role.label())
                        </span>
                    </span>
                    icon(
                        data: iconify_icon!("lucide:chevrons-up-down"),
                        attrs: attributes! { class="ml-auto" }
                    )
                </span>
            )
            // The menu opens beside the sidebar with its bottom edge level with the
            // trigger's, so it grows upward and keeps the footer's spacing from the
            // bottom of the window.
            dropdown_menu_content(
                id: &menu,
                side: FloatingSide::Right,
                align: FloatingAlign::End,
                dropdown_menu_label(
                    <span class="block text-sm text-foreground">(&user.name)</span>
                    (&user.email)
                )
                dropdown_menu_separator()
                <form method="post" action=(href!(logout::submit))>
                    dropdown_menu_item(
                        attrs: attributes! { type="submit" },
                        icon(data: iconify_icon!("lucide:log-out"))
                        "Sign out"
                    )
                </form>
            )
        )
    })
}

/// The trail from the back office to the current page.
#[component]
async fn page_breadcrumb(cx: &Cx) -> Result<impl View> {
    let current = NAV.iter().find(|item| href!(item.target).is_current(cx));

    Ok(view! {
        breadcrumb(
            breadcrumb_list(
                breadcrumb_item("Backroom")
                if let Some(item) = current {
                    breadcrumb_separator()
                    breadcrumb_item(breadcrumb_page((item.label)))
                }
            )
        )
    })
}

/// A button that switches between the light and dark themes.
///
/// It submits a form, and the page reloads in the new theme.
#[component]
async fn theme_toggle(cx: &Cx) -> Result<impl View> {
    let dark = theme(cx) == Theme::Dark;
    let label = if dark {
        "Switch to light theme"
    } else {
        "Switch to dark theme"
    };
    let return_to = uri(cx).path_and_query().map_or("/", |path| path.as_str());

    Ok(view! {
        <form method="post" action=(href!(super::theme::toggle)) class="ml-auto">
            <input type="hidden" name="return_to" value=(return_to)>
            button(
                variant: ButtonVariant::Ghost,
                size: ButtonSize::Icon,
                attrs: attributes! { type="submit" aria-label=(label) title=(label) },
                if dark {
                    icon(data: iconify_icon!("lucide:sun"))
                } else {
                    icon(data: iconify_icon!("lucide:moon"))
                }
            )
        </form>
    })
}

/// The dashboard, the first page after signing in.
#[page]
pub async fn page(cx: &Cx) -> Result<impl View> {
    let user = require_user(cx).await?;
    let first_name = user.name.split_whitespace().next().unwrap_or(&user.name);

    Ok(view! {
        <header class="flex flex-col gap-1">
            <h1 class="text-2xl font-semibold tracking-tight">
                "Welcome back, "
                (first_name)
            </h1>
            <p class="text-muted-foreground">
                "Here is what is happening in the store."
            </p>
        </header>
    })
}
