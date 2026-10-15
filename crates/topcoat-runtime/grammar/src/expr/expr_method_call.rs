use std::fmt::Write;

use proc_macro2::TokenStream;
use quote::{ToTokens, quote};
use syn::ExprMethodCall;
use topcoat_core_grammar::paths::topcoat_runtime;

use super::js::Js;
use crate::expr::{Expr, name_resolver::NameResolver};

impl Expr {
    pub(super) fn expr_method_call(
        call: &ExprMethodCall,
        rust: &mut TokenStream,
        js: &mut Js,
        names: &mut NameResolver,
    ) -> syn::Result<()> {
        if let Some(turbofish) = &call.turbofish {
            return Err(syn::Error::new_spanned(
                turbofish,
                "turbofish is not supported",
            ));
        }

        let mut receiver = TokenStream::new();
        Self::dispatch(&call.receiver, &mut receiver, js, names)?;

        let method = &call.method;

        // JavaScript treats any object with a callable `then` property as a
        // Promise-like thenable. Exposing Rust's `bool::then` under that
        // name causes boolean procedure results resolve to `undefined`.
        // To prevent this, here we add an exception for methods named `then`
        // to be defined as `then_`.
        if method == "then" {
            js.push_str(".then_(");
        } else {
            write!(js, ".{method}(").unwrap();
        }

        let mut args = Vec::with_capacity(call.args.len());
        for (i, arg) in call.args.iter().enumerate() {
            if i > 0 {
                js.push_str(", ");
            }
            let mut tokens = TokenStream::new();
            Self::dispatch(arg, &mut tokens, js, names)?;
            args.push(tokens);
        }
        if method == "to_lowercase" {
            if !args.is_empty() {
                js.push_str(", ");
            }
            // Evaluate on the Rust target, not the proc-macro host. The
            // browser chooses pinned tables for this exact Unicode version.
            let version = names.capture_value(
                quote! {
                    #topcoat_runtime::Expr::from(const {
                        match ::core::char::UNICODE_VERSION {
                            (17, 0, 0) => "17.0.0",
                            (18, 0, 0) => "18.0.0",
                            _ => ::core::panic!("unsupported lowercase Unicode version; regenerate browser tables"),
                        }
                    })
                },
                method.span(),
            );
            js.expression(&version);
        }
        js.push(')');

        quote! { (#receiver).#method(#(#args),*) }.to_tokens(rust);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lowercase_captures_the_target_unicode_version() {
        let expression: Expr = syn::parse_str("text.to_lowercase()").unwrap();
        let expanded = expression.expr_to_tokens().unwrap().to_string();
        // A host-side lookup would erase this path from the emitted Rust.
        assert!(expanded.contains(":: core :: char :: UNICODE_VERSION"));
    }
}
