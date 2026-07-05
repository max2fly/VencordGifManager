/*
 * Injects a right-aligned "Caption maker" button into Discord's ExpressionPicker
 * tab row (the GIFs / Stickers / Emoji tablist), opening the caption editor.
 *
 * There is NO Vencord webpack precedent for patching that nav row and its minified
 * shape can't be verified here, so we key off the rendered DOM instead: the tabs
 * carry fixed, non-localized ids (`emoji-picker-tab` is always present) and the
 * container is a `role="tablist"`. The per-build class hash (navList__xxxxx) is
 * deliberately NOT used — it changes every Discord update.
 */

import { openCaptionEditor } from "../components/CaptionEditorModal";

const BTN_ID = "gifmgr-caption-nav-btn";

let observer: MutationObserver | null = null;
let scheduled = false;

// The emoji tab is present on every ExpressionPicker view; its parent is the tablist.
function findNavList(): HTMLElement | null {
    const nav = document.getElementById("emoji-picker-tab")?.parentElement;
    return nav?.getAttribute("role") === "tablist" ? (nav as HTMLElement) : null;
}

function buildButton(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "✏️ Caption maker";
    Object.assign(btn.style, {
        marginLeft: "auto",
        alignSelf: "center",
        padding: "3px 12px",
        borderRadius: "6px",
        border: "none",
        // Discord's brand accent — filled so it stands out from the muted tab labels.
        background: "var(--brand-500, var(--brand-experiment, #5865f2))",
        color: "#fff",
        font: "inherit",
        fontSize: "13px",
        fontWeight: "600",
        lineHeight: "20px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "background-color .15s ease, filter .15s ease"
    });
    btn.onmouseenter = () => { btn.style.filter = "brightness(1.12)"; };
    btn.onmouseleave = () => { btn.style.filter = "none"; };
    // Stop propagation so the tablist's delegated click handler doesn't treat this
    // as a tab activation.
    btn.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        openCaptionEditor();
    };
    return btn;
}

function inject() {
    const nav = findNavList();
    if (!nav || nav.querySelector(`#${BTN_ID}`)) return;
    nav.appendChild(buildButton());
}

// Coalesce the flood of unrelated DOM mutations down to one cheap check per frame.
function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
        scheduled = false;
        inject();
    });
}

export function enableCaptionNavButton() {
    if (observer) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    inject(); // in case the picker is already open when the plugin starts
}

export function disableCaptionNavButton() {
    observer?.disconnect();
    observer = null;
    document.getElementById(BTN_ID)?.remove();
}
