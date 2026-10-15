"use strict";(()=>{var m=class{constructor(e,t){this.handlers=t;let o=new URL(e);o.protocol=o.protocol==="https:"?"wss:":"ws:",o.pathname="/ws",o.search="",o.hash="",this.url=o.href}handlers;url;lifetime=new AbortController;socket=null;retry;navigating=!1;get isNavigating(){return this.navigating}start(){let e={signal:this.lifetime.signal},t=()=>{this.navigating=!0,this.handlers.navigating()};window.navigation?.addEventListener("navigate",t,e),window.addEventListener("pagehide",t,e),window.navigation?.addEventListener("navigateerror",()=>{this.navigating=!1},e),window.addEventListener("pageshow",()=>{this.navigating=!1},e),this.connect(!1)}stop(){this.lifetime.abort(),clearTimeout(this.retry);let e=this.socket;this.socket=null,e?.close()}connect(e){let t=new WebSocket(this.url);this.socket=t,t.onopen=()=>{this.socket===t&&e&&!this.navigating&&this.handlers.reconnected()},t.onmessage=({data:o})=>{if(this.socket===t)switch(o){case"reload":case"rebuilding":case"build-failed":case"app-exited":case"up-to-date":this.handlers.event(o)}},t.onclose=()=>{this.socket===t&&(this.socket=null,this.reconnect())}}reconnect(){this.retry=setTimeout(()=>{this.lifetime.signal.aborted||(this.navigating?this.reconnect():this.connect(!0))},500)}};var C="topcoat:dev-runtime:v3";var y="application/x-ndjson";async function*x(n){let e=n.body;if(e===null){yield*S((await n.text()).split(`
`));return}let t=e.getReader(),o=new TextDecoder,r="";try{for(;;){let{done:i,value:s}=await t.read();r+=o.decode(s,{stream:!i});let a=r.split(`
`);if(r=a.pop()??"",yield*S(a),i)break}}finally{t.releaseLock()}yield*S([r])}function*S(n){for(let e of n)e.trim()!==""&&(yield JSON.parse(e))}function M(n,e,t,o,r={}){let i=Array.from(o),s=H(n,e,t),a=U(n,s,i,r),d=s[0],l=i[0];if(n.nodeType===Node.DOCUMENT_NODE&&d instanceof Element&&l instanceof Element&&s.length===1&&i.length===1){g(a,d,l);return}N(a,n,e?e.nextSibling:n.firstChild,t,i)}function H(n,e,t){let o=[],r=e?e.nextSibling:n.firstChild;for(;r&&r!==t;)o.push(r),r=r.nextSibling;return o}function U(n,e,t,o){let r=new Map;for(let l of e)for(let c of E(l))r.set(c.id,c);let i=new Set;for(let l of t)for(let c of E(l))r.has(c.id)&&i.add(c.id);let s=new Map,a=l=>{for(let c of l)for(let f of E(c)){if(!i.has(f.id))continue;let u=f;for(;u;){let p=s.get(u);if(p||(p=new Set,s.set(u,p)),p.add(f.id),u===c)break;u=u.parentNode}}};a(e),a(t);let d=new Map;for(let l of i){let c=r.get(l);c&&d.set(l,c)}return{options:o,preservedSelects:new WeakSet,persistent:i,idSets:s,oldById:d,active:(n.ownerDocument??n).activeElement}}function E(n){if(!(n instanceof Element))return[];let e=Array.from(n.querySelectorAll("[id]"));return n.id&&e.unshift(n),e}function N(n,e,t,o,r){let i=t;for(let s of r){if(e instanceof Element&&s instanceof Element){let a=e.closest("select");if(a&&n.preservedSelects.has(a)){let d=s instanceof HTMLOptionElement?[s]:Array.from(s.querySelectorAll("option"));for(let l of d)l.removeAttribute("selected"),l.selected=!1}}if(i&&i!==o){let a=P(n,s,i,o);if(a){_(n,i,a),i=g(n,a,s).nextSibling;continue}}if(s instanceof Element&&n.persistent.has(s.id)){let a=n.oldById.get(s.id);if(a){if(h(n,a,s)&&B(n,e,a,s,i)){i=g(n,a,s).nextSibling;continue}i===a&&(i=a.nextSibling),w(n,a)}}i=$(n,e,s,i).nextSibling}for(;i&&i!==o;){let s=i.nextSibling;w(n,i),i=s}}function P(n,e,t,o){let r=null,i=e.nextSibling,s=0,a=0,d=n.idSets.get(e)?.size??0,l=t;for(;l&&l!==o;){if(h(n,l,e)){if(F(n,l,e))return l;r===null&&!n.idSets.has(l)&&(r=l)}if(r===null&&i&&h(n,l,i)&&(s++,i=i.nextSibling,s>=2&&(r=void 0)),n.active&&l.contains(n.active)||(a+=n.idSets.get(l)?.size??0,a>d))break;l=l.nextSibling}return r??null}function h(n,e,t){return!(e.nodeType!==t.nodeType||e instanceof Element&&t instanceof Element&&(e.tagName!==t.tagName||e.namespaceURI!==t.namespaceURI||n.options.canReuseElement?.(e,t,!1)===!1||e.id&&e.id!==t.id&&n.persistent.has(e.id)))}function F(n,e,t){let o=n.idSets.get(e),r=n.idSets.get(t);if(!o||!r)return!1;for(let i of o)if(r.has(i))return!0;return!1}function _(n,e,t){let o=e;for(;o&&o!==t;){let r=o.nextSibling;w(n,o),o=r}}function w(n,e){n.options.beforeRemove?.(e),e.remove()}function g(n,e,t){if(e instanceof Element&&t instanceof Element){if(h(n,e,t)){let o=q(n,e);for(let r of n.options.preserveAttributes?.(e,t)??[])o.add(r);return W(e,t,o),n.options.preserveFormState&&e instanceof HTMLTextAreaElement||N(n,e,e.firstChild,null,Array.from(t.childNodes)),e}}else if(e.nodeType===t.nodeType)return e.nodeValue!==t.nodeValue&&(e.nodeValue=t.nodeValue),e;return n.options.beforeRemove?.(e),e.replaceWith(t),t}function $(n,e,t,o){if(t instanceof Element&&n.idSets.has(t)){let i=(e.ownerDocument??document).createElementNS(t.namespaceURI,t.localName);return e.insertBefore(i,o),g(n,i,t)}return e.insertBefore(t,o),t}function B(n,e,t,o,r){if(t.parentNode===e&&(t===r||t.nextSibling===r))return!0;let i=e;if(i.moveBefore&&t.isConnected)try{return i.moveBefore(t,r),!0}catch{}return n.options.canReuseElement?.(t,o,!0)===!1?!1:(e.insertBefore(t,r),!0)}function q(n,e){let t=new Set;if(!n.options.preserveFormState)return t;if(e instanceof HTMLInputElement)t.add("value"),t.add("checked");else if(e instanceof HTMLTextAreaElement)t.add("value");else if(e instanceof HTMLSelectElement)n.preservedSelects.add(e),t.add("value");else if(e instanceof HTMLOptionElement){let o=e.closest("select");o&&n.preservedSelects.has(o)&&t.add("selected")}return t}function W(n,e,t){for(let o of Array.from(e.attributes))t.has(o.name)||(o.namespaceURI===null?n.getAttribute(o.name)!==o.value&&n.setAttribute(o.name,o.value):n.getAttributeNS(o.namespaceURI,o.localName)!==o.value&&n.setAttributeNS(o.namespaceURI,o.name,o.value));for(let o of Array.from(n.attributes))t.has(o.name)||(o.namespaceURI===null?e.hasAttribute(o.name)||n.removeAttribute(o.name):e.hasAttributeNS(o.namespaceURI,o.localName)||n.removeAttributeNS(o.namespaceURI,o.localName))}function T(n){let e=o=>JSON.stringify(Array.from(o.scripts,r=>r.outerHTML)),t=o=>{let r=o.doctype;return JSON.stringify(r&&[r.name,r.publicId,r.systemId])};return e(document)===e(n)&&t(document)===t(n)&&document.querySelector("base")?.outerHTML===n.querySelector("base")?.outerHTML}function R(n,e={}){let t=document.documentElement,o=n.documentElement,{scrollX:r,scrollY:i}=window;M(document,t.previousSibling,t.nextSibling,[o],{preserveFormState:!0,...e}),window.scrollTo({left:r,top:i,behavior:"instant"})}function k(n,e){let t=document.createTreeWalker(document,NodeFilter.SHOW_COMMENT),o=null;for(let r=t.nextNode();r;r=t.nextNode()){let i=r;if(i.data.trim()===`::topcoat::region::start(${n})`)o=i;else if(i.data.trim()===`::topcoat::region::end(${n})`){let s=o?.parentNode;if(!(s instanceof Element)||i.parentNode!==s)return;let a=document.createElementNS(s.namespaceURI,s.localName);a.innerHTML=e,M(s,o,i,a.childNodes,{preserveFormState:!0});return}}}var v=class{constructor(e,t,o){this.navigating=e;this.beforeUpdate=t;this.reportError=o}navigating;beforeUpdate;reportError;controller=null;cancel(){this.controller?.abort(),this.controller=null}async refresh(){if(this.cancel(),this.navigating())return;if(document.readyState==="loading"){location.reload();return}let e=new AbortController;this.controller=e;let t,o=new Promise(s=>{t=s});e.signal.addEventListener("abort",t,{once:!0});let r=location.href,i=()=>this.controller===e&&!this.navigating()&&location.href===r;try{let s={};window.dispatchEvent(new CustomEvent(C,{detail:s}));let a=await(s.runtime?.request(e.signal,o)??fetch(r,{cache:"no-store",headers:{Accept:y},signal:e.signal}));if(!i())return;if(a.redirected){location.assign(a.url);return}if(!a.ok)throw new Error(`Refresh failed: ${a.status} ${a.statusText}`);if(a.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase()!==y){location.reload();return}let d=!1;for await(let l of x(a)){if(!i())return;switch(l.t){case"snapshot":{let c=new DOMParser().parseFromString(l.html,"text/html");if(!T(c)){location.reload();return}this.beforeUpdate();let f=(u={})=>R(c,u);s.runtime?s.runtime.replace(f):f(),d=!0;break}case"swap":if(!d)throw new Error("Refresh update arrived before its page");s.runtime?s.runtime.swap(l.region,l.html):k(l.region,l.html);break;case"redirect":location.assign(l.location);return;case"error":throw new Error(`Refresh render failed: ${l.status}`)}}if(i()&&!d)throw new Error("Refresh response contained no page")}catch(s){i()&&this.reportError(s)}finally{e.abort(),t(),this.controller===e&&(this.controller=null)}}};var b=class{constructor(e){this.enabled=e;if(e){document.addEventListener("DOMContentLoaded",()=>this.render(),{once:!0});for(let t of["400","600"]){let o=new FontFace(L,`url(${V}${t}-normal.woff2) format("woff2")`,{weight:t,display:"swap"});document.fonts.add(o),o.load().catch(()=>{})}}}enabled;pill=null;current=null;show(e,t=!1){this.enabled&&(this.current={label:e,isError:t},this.render())}hide(){this.current=null,this.pill?.host.remove()}render(){if(!this.current||!document.body)return;this.pill??=this.createPill();let{host:e,label:t,spinner:o}=this.pill;t.textContent=this.current.label,t.className=this.current.isError?"error":"busy",o.style.display=this.current.isError?"none":"",e.isConnected||document.body.append(e)}createPill(){let e=document.createElement("topcoat-dev-status");e.style.cssText=Y;let t=e.attachShadow({mode:"open"});t.innerHTML=J;let o=t.querySelector("b"),r=t.querySelector(".spinner");return t.querySelector("button").addEventListener("click",()=>this.hide()),{host:e,label:o,spinner:r}}},A="#a1a1aa",D="#fca5a5",L="Topcoat Dev",V="https://cdn.jsdelivr.net/fontsource/fonts/lexend-deca@latest/latin-",I=n=>`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${n}</svg>`,j=I('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),z=I('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>'),Y=`
  all: initial;
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px 7px 14px;
  background: #0a0a0a;
  color: #fff;
  border: 1px solid #000;
  border-radius: 8px;
  font: 12px/1 "${L}", ui-sans-serif, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  user-select: none;
`,J=`
  <style>
    .brand {
      color: ${A};
    }
    b {
      font-weight: 600;
    }

    /* all:unset strips the UA button styles. */
    .dismiss {
      all: unset;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 4px;
      cursor: pointer;
      color: ${A};
      transition: color 0.15s ease;
    }
    .dismiss:hover {
      color: #fff;
    }

    .busy {
      color: #a5f3fc;
    }
    .spinner {
      display: flex;
      color: #a5f3fc;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Error labels catch the eye with a soft highlight sweeping across
       the text once every three seconds. */
    .error {
      background-image:
        linear-gradient(100deg, ${D} 30%, #fecaca 50%, ${D} 70%);
      background-size: 300% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      animation: shimmer 3s ease-in-out infinite;
    }
    @keyframes shimmer {
      0% { background-position: 100% 0; }
      25% { background-position: 0 0; }
      100% { background-position: 0 0; }
    }
  </style>
  <span class="brand">topcoat</span>
  <b></b>
  <span class="spinner">${z}</span>
  <button class="dismiss" aria-label="Dismiss">${j}</button>
`;function G(n){let e=new b(n.dataset.statusIndicator!=="false"),t=new m(n.src,{event:i=>r[i](),reconnected:()=>{o.refresh()},navigating:()=>o.cancel()}),o=new v(()=>t.isNavigating,()=>e.hide(),i=>{console.error("[topcoat dev]",i),e.show("refresh failed",!0)}),r={reload:()=>{e.hide(),o.refresh()},rebuilding:()=>{o.cancel(),e.show("rebuilding")},"build-failed":()=>e.show("build failed",!0),"app-exited":()=>e.show("app exited",!0),"up-to-date":()=>e.hide()};t.start()}var O=document.currentScript;O instanceof HTMLScriptElement&&G(O);})();
