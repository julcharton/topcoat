//! The back office for signed-in staff.
//!
//! The leading underscore makes this module a group: its layout wraps every page
//! below it without adding a segment to their URLs.

use topcoat::{
    Result,
    context::Cx,
    icon::{IconData, icon, iconify::iconify_icon},
    router::{HrefTarget, Slot, href, layout, page},
    runtime::{Event, Signal, link, signal},
    view::{View, attributes, component, view},
};

use super::{login::require_user, logout};
use crate::{
    components::{
        avatar::{AvatarSize, avatar, avatar_fallback},
        breadcrumb::{
            breadcrumb, breadcrumb_item, breadcrumb_list, breadcrumb_page, breadcrumb_separator,
        },
        button::{ButtonSize, ButtonVariant, button},
        separator::{SeparatorOrientation, separator},
        sidebar::{
            SidebarCollapsible, SidebarMenuButtonSize, SidebarMenuButtonVariant, sidebar,
            sidebar_content, sidebar_footer, sidebar_group, sidebar_group_content,
            sidebar_group_label, sidebar_header, sidebar_inset, sidebar_menu,
            sidebar_menu_button_variants, sidebar_menu_item, sidebar_provider, sidebar_trigger,
        },
    },
    features::user::User,
};

/// The `id` of the sidebar, referenced by the buttons that toggle it.
const SIDEBAR_ID: &str = "app-sidebar";

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

    // The desktop sidebar and the mobile sheet open and close independently.
    let open = signal(cx, || true);
    let mobile_open = signal(cx, || false);

    Ok(view! {
        sidebar_provider(
            app_sidebar(user: user, open: &open, mobile_open: &mobile_open)
            sidebar_inset(
                sidebar_header(
                    sidebar_trigger(
                        open: $(open.get()),
                        attrs: attributes! {
                            class="max-md:hidden"
                            aria-controls=(SIDEBAR_ID)
                            @click=$(|_e: Event| open.toggle())
                        }
                    )
                    sidebar_trigger(
                        open: $(mobile_open.get()),
                        attrs: attributes! {
                            class="md:hidden"
                            aria-controls=(SIDEBAR_ID)
                            @click=$(|_e: Event| mobile_open.toggle())
                        }
                    )
                    separator(orientation: SeparatorOrientation::Vertical)
                    page_breadcrumb()
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
                id=(SIDEBAR_ID)
                aria-label="Back office navigation"
                @keydown=$(|e: Event| {
                    if e.key == "Escape" {
                        mobile_open.set(false);
                    }
                })
                @click=$(|e: Event| {
                    // A click on the backdrop targets the sheet itself.
                    if e.target.id == SIDEBAR_ID {
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
            sidebar_footer(
                sidebar_menu(
                    sidebar_menu_item(
                        <div
                            title=(&user.name)
                            class=(sidebar_menu_button_variants(
                                SidebarMenuButtonVariant::Default,
                                SidebarMenuButtonSize::Lg,
                            ))
                        >
                            avatar(
                                size: AvatarSize::Sm,
                                avatar_fallback((user.initials()))
                            )
                            <span class="flex flex-col">
                                <span class="truncate font-medium">(&user.name)</span>
                                <span class="truncate text-xs text-muted-foreground">
                                    (user.role.label())
                                </span>
                            </span>
                        </div>
                    )
                    sidebar_menu_item(
                        <form method="post" action=(href!(logout::submit))>
                            <button
                                type="submit"
                                title="Sign out"
                                class=(sidebar_menu_button_variants(
                                    SidebarMenuButtonVariant::Default,
                                    SidebarMenuButtonSize::Md,
                                ))
                            >
                                icon(data: iconify_icon!("lucide:log-out"))
                                <span>"Sign out"</span>
                            </button>
                        </form>
                    )
                )
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
