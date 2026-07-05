/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
*/

import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { Button, Forms, React, Text, Toasts, useEffect, useRef, useState } from "@webpack/common";

import { FONT_STACKS, measureTextLayer } from "../utils/caption";
import { composite, EditorModel, exportCaptioned, TextLayer } from "../utils/captionExport";
import { corners, hitTestTop, localToWorld, Sized } from "../utils/editorModel";
import { decodeFrames } from "../utils/frames";
import { stageBlob } from "../utils/mediaConvert";
import { sniffExt } from "../utils/sniff";

const MAX_PREVIEW = 460;   // px, longest displayed side
const HANDLE = 9;          // handle square size, display px
const ROT_OFF = 26;        // rotate-handle distance above the layer, display px

let idSeq = 0;
const newId = () => `t${idSeq++}`;

// Offscreen ctx for measuring text-layer sizes (hit-testing / handles).
const measCanvas = document.createElement("canvas");
const measCtx = measCanvas.getContext("2d")!;
function textSize(l: TextLayer) { const m = measureTextLayer(measCtx as any, l); return { w: m.w, h: m.h }; }

function newTextLayer(W: number, H: number, cx = W / 2, cy = H / 2): TextLayer {
    return {
        id: newId(),
        t: { cx, cy, scale: 1, rot: 0 },
        text: "Text",
        boxW: Math.max(80, Math.round(W * 0.85)),
        fontPx: Math.max(16, Math.round(H * 0.11)),
        font: FONT_STACKS.Impact,
        bold: true, italic: false,
        color: "#ffffff",
        outline: true, outlineW: 0.14,
        align: "center"
    };
}

type Decoded = { frames: HTMLCanvasElement[]; delays: number[]; fw: number; fh: number; };
type Sel = { kind: "media"; } | { kind: "text"; id: string; } | null;
type Drag =
    | { mode: "move"; offx: number; offy: number; }
    | { mode: "scale"; }
    | { mode: "rotate"; }
    | {
        // one canvas edge being dragged; disp is frozen so content keeps its screen size
        // (paint-style crop/extend) instead of smooshing until release.
        mode: "canvas"; h: "l" | "r" | null; v: "t" | "b" | null;
        sx: number; sy: number; sW: number; sH: number; disp0: number;
        base: { mediaCx: number; mediaCy: number; texts: { id: string; cx: number; cy: number; }[]; };
    }
    | null;

// Canvas resize grips at the 4 edge MIDPOINTS (output px). Edges, not corners, so they never
// collide with a layer's corner scale handles → precise single-side crop/extend like MS Paint.
type EdgeGrip = { h: "l" | "r" | null; v: "t" | "b" | null; x: number; y: number; };
function canvasEdges(W: number, H: number): EdgeGrip[] {
    return [
        { h: "l", v: null, x: 0, y: H / 2 },
        { h: "r", v: null, x: W, y: H / 2 },
        { h: null, v: "t", x: W / 2, y: 0 },
        { h: null, v: "b", x: W / 2, y: H }
    ];
}

function Editor({ initial, modalProps }: { initial: { blob: Blob; ext: string; } | null; modalProps: ModalProps; }) {
    const [dec, setDec] = useState<Decoded | null>(null);
    const [sel, setSel] = useState<Sel>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [, bump] = useState(0);
    const rerender = () => bump(n => n + 1);

    const model = useRef<EditorModel | null>(null);
    const decRef = useRef<Decoded | null>(null);
    const selRef = useRef<Sel>(null); selRef.current = sel;
    const dispRef = useRef(1);
    const dirty = useRef(true);   // static frames only repaint when this is set (or during a drag)
    const drag = useRef<Drag>(null);
    const canvasEl = useRef<HTMLCanvasElement | null>(null);
    const fileInput = useRef<HTMLInputElement | null>(null);

    // ---- load a source into frames + a fresh document ----
    async function loadBytes(blob: Blob, ext: string) {
        try {
            setError(null);
            const buf = new Uint8Array(await blob.arrayBuffer());
            const sniffed = sniffExt(buf) ?? ext ?? "gif";
            const d = await decodeFrames(new Blob([buf]), sniffed);
            if (!d.frames.length) throw new Error("no frames decoded");
            const decoded: Decoded = { frames: d.frames, delays: d.delays, fw: d.w, fh: d.h };
            decRef.current = decoded;
            model.current = {
                W: d.w, H: d.h, bg: "#ffffff",
                media: { t: { cx: d.w / 2, cy: d.h / 2, scale: 1, rot: 0 } },
                texts: []
            };
            setDec(decoded);
            setSel({ kind: "media" });
        } catch (e) {
            console.error("[GifManager] caption editor load failed", e);
            setError("Couldn't load that file.");
        }
    }

    useEffect(() => { if (initial) void loadBytes(initial.blob, initial.ext); }, []);

    // ---- animation loop: composite the current frame + selection handles ----
    useEffect(() => {
        if (!dec) return;
        let raf = 0, idx = 0, acc = 0, last = performance.now();
        const animated = decRef.current!.frames.length > 1;
        const step = (ts: number) => {
            const d = decRef.current!;
            acc += ts - last; last = ts;
            if (animated) {
                while (acc >= (d.delays[idx] || 60)) { acc -= d.delays[idx] || 60; idx = (idx + 1) % d.frames.length; }
                draw(idx);
            } else if (dirty.current || drag.current) {
                // Static image: avoid re-compositing the (possibly large) canvas every frame — only
                // repaint on a React render (selection/edit) or while actively dragging.
                dirty.current = false;
                draw(0);
            }
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [dec]);

    function sizedLayers(): (Sized & { key: string; })[] {
        const m = model.current!, d = decRef.current!;
        return [
            { key: "media", t: m.media.t, w: d.fw, h: d.fh },
            ...m.texts.map(l => { const s = textSize(l); return { key: l.id, t: l.t, w: s.w, h: s.h }; })
        ];
    }
    function selSized() {
        const s = sel;
        if (!s) return null;
        return sizedLayers().find(l => (s.kind === "media" ? l.key === "media" : l.key === s.id)) ?? null;
    }

    function draw(idx: number) {
        const cv = canvasEl.current, m = model.current, d = decRef.current;
        if (!cv || !m || !d) return;
        if (cv.width !== m.W) cv.width = m.W;
        if (cv.height !== m.H) cv.height = m.H;
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        composite(ctx, d.frames[idx], d.fw, d.fh, m);

        // handles (preview-only; never part of the export canvas)
        const disp = dispRef.current;
        const hs = HANDLE / disp;
        ctx.lineWidth = 1.5 / disp;
        // canvas resize grips at the 4 edge midpoints (crop / extend, MS-Paint style)
        ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#111";
        for (const g of canvasEdges(m.W, m.H)) {
            const gx = g.h === "l" ? 0 : g.h === "r" ? m.W - hs : m.W / 2 - hs / 2;
            const gy = g.v === "t" ? 0 : g.v === "b" ? m.H - hs : m.H / 2 - hs / 2;
            ctx.fillRect(gx, gy, hs, hs); ctx.strokeRect(gx, gy, hs, hs);
        }

        const s = selSized();
        if (s) {
            const c = corners(s.t, s.w, s.h);
            ctx.strokeStyle = "#00a8fc";
            ctx.beginPath();
            ctx.moveTo(c[0].x, c[0].y);
            for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
            ctx.closePath(); ctx.stroke();
            ctx.fillStyle = "#00a8fc";
            for (const p of c) ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
            // rotate handle above the top edge
            const rp = localToWorld(s.t, 0, -s.h / 2 - ROT_OFF / disp / s.t.scale);
            const tc = localToWorld(s.t, 0, -s.h / 2);
            ctx.beginPath(); ctx.moveTo(tc.x, tc.y); ctx.lineTo(rp.x, rp.y); ctx.stroke();
            ctx.beginPath(); ctx.arc(rp.x, rp.y, hs / 1.5, 0, Math.PI * 2); ctx.fill();
        }
    }

    // ---- pointer interaction (coordinates in output px) ----
    function toOut(e: React.PointerEvent) {
        const cv = canvasEl.current!, r = cv.getBoundingClientRect();
        return { x: (e.clientX - r.left) / dispRef.current, y: (e.clientY - r.top) / dispRef.current };
    }
    const near = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by) <= (HANDLE + 4) / dispRef.current;

    function onDown(e: React.PointerEvent) {
        if (!model.current || editing) return;
        const p = toOut(e), m = model.current;
        canvasEl.current!.setPointerCapture(e.pointerId);

        // canvas edge grips first — they sit at edge midpoints so they never shadow a layer's
        // corner scale handles. Freeze the current display scale for a smooth, 1:1 drag.
        for (const g of canvasEdges(m.W, m.H)) {
            if (near(p.x, p.y, g.x, g.y)) {
                drag.current = {
                    mode: "canvas", h: g.h, v: g.v,
                    sx: e.clientX, sy: e.clientY, sW: m.W, sH: m.H, disp0: dispRef.current,
                    base: { mediaCx: m.media.t.cx, mediaCy: m.media.t.cy, texts: m.texts.map(t => ({ id: t.id, cx: t.t.cx, cy: t.t.cy })) }
                };
                return;
            }
        }

        const s = selSized();
        if (s) {
            const rp = localToWorld(s.t, 0, -s.h / 2 - ROT_OFF / dispRef.current / s.t.scale);
            if (near(p.x, p.y, rp.x, rp.y)) { drag.current = { mode: "rotate" }; return; }
            for (const c of corners(s.t, s.w, s.h)) if (near(p.x, p.y, c.x, c.y)) { drag.current = { mode: "scale" }; return; }
        }

        const layers = sizedLayers();
        const hit = hitTestTop(layers, p.x, p.y);
        if (hit < 0) { setSel(null); drag.current = null; return; }
        const layer = layers[hit];
        setSel(layer.key === "media" ? { kind: "media" } : { kind: "text", id: layer.key });
        drag.current = { mode: "move", offx: p.x - layer.t.cx, offy: p.y - layer.t.cy };
    }

    function onMove(e: React.PointerEvent) {
        const dm = drag.current, m = model.current;
        if (!m) return;
        if (!dm) {
            // hover feedback: edge grips show resize cursors, everywhere else = move
            const hp = toOut(e);
            const g = canvasEdges(m.W, m.H).find(h => near(hp.x, hp.y, h.x, h.y));
            canvasEl.current!.style.cursor = g ? (g.h ? "ew-resize" : "ns-resize") : "move";
            return;
        }
        if (dm.mode === "canvas") {
            // Move ONE edge in output px (frozen scale → 1:1 with the cursor). Growing an edge
            // reveals background; shrinking crops. l/t edges also shift every layer so content
            // stays put relative to the surviving canvas (true crop, not a rescale).
            const dxOut = (e.clientX - dm.sx) / dm.disp0;
            const dyOut = (e.clientY - dm.sy) / dm.disp0;
            let W = dm.sW, H = dm.sH, shiftX = 0, shiftY = 0;
            if (dm.h === "r") W = Math.max(16, Math.round(dm.sW + dxOut));
            else if (dm.h === "l") { W = Math.max(16, Math.round(dm.sW - dxOut)); shiftX = dm.sW - W; }
            if (dm.v === "b") H = Math.max(16, Math.round(dm.sH + dyOut));
            else if (dm.v === "t") { H = Math.max(16, Math.round(dm.sH - dyOut)); shiftY = dm.sH - H; }
            m.W = W; m.H = H;
            m.media.t.cx = dm.base.mediaCx - shiftX; m.media.t.cy = dm.base.mediaCy - shiftY;
            for (const t of m.texts) { const b = dm.base.texts.find(x => x.id === t.id); if (b) { t.t.cx = b.cx - shiftX; t.t.cy = b.cy - shiftY; } }
            rerender();
            return;
        }
        const s = selSized();
        if (!s) return;
        const p = toOut(e);
        if (dm.mode === "move") { s.t.cx = p.x - dm.offx; s.t.cy = p.y - dm.offy; }
        else if (dm.mode === "rotate") { s.t.rot = Math.atan2(p.y - s.t.cy, p.x - s.t.cx) + Math.PI / 2; }
        else if (dm.mode === "scale") {
            const half = Math.hypot(s.w / 2, s.h / 2) || 1;
            s.t.scale = Math.max(0.05, Math.hypot(p.x - s.t.cx, p.y - s.t.cy) / half);
        }
    }
    function onUp(e: React.PointerEvent) { drag.current = null; canvasEl.current?.releasePointerCapture(e.pointerId); rerender(); }

    function onDouble(e: React.PointerEvent) {
        if (!model.current) return;
        const p = toOut(e);
        const layers = sizedLayers();
        const hit = hitTestTop(layers, p.x, p.y);
        if (hit > 0) { const id = layers[hit].key; setSel({ kind: "text", id }); setEditing(id); }
        else addText(p.x, p.y);   // empty space or media (non-text) → drop a new text box here
    }

    // ---- model edits ----
    const selText = (): TextLayer | null => (sel?.kind === "text" ? model.current!.texts.find(t => t.id === sel.id) ?? null : null);
    const patch = (over: Partial<TextLayer>) => { const t = selText(); if (t) { Object.assign(t, over); rerender(); } };
    function addText(cx?: number, cy?: number) {
        const m = model.current!; const l = newTextLayer(m.W, m.H, cx, cy); m.texts.push(l);
        setSel({ kind: "text", id: l.id }); setEditing(l.id); rerender();
    }
    function deleteSel() {
        const m = model.current!;
        if (sel?.kind === "text") { m.texts = m.texts.filter(t => t.id !== sel.id); setSel(null); rerender(); }
    }

    async function addToMessage() {
        setBusy(true);
        try {
            const d = decRef.current!, m = model.current!;
            const { blob, filename } = await exportCaptioned(d.frames, d.delays, m);
            if (stageBlob(blob, filename)) {
                Toasts.show({ message: "Captioned media added to your message", type: Toasts.Type.SUCCESS, id: Toasts.genId(), options: { duration: 3000, position: Toasts.Position.BOTTOM } });
                modalProps.onClose();
            }
        } catch (e) {
            console.error("[GifManager] caption export failed", e);
            Toasts.show({ message: "Caption export failed — see console", type: Toasts.Type.FAILURE, id: Toasts.genId(), options: { duration: 4000, position: Toasts.Position.BOTTOM } });
        } finally { setBusy(false); }
    }

    // ---- file intake (drop zone / browse / paste) ----
    function fileFromDrop(f: File) { void loadBytes(f, (f.name.split(".").pop() ?? "").toLowerCase()); }
    function onPaste(e: React.ClipboardEvent) {
        if (model.current) return; // only when picking a source
        for (const it of e.clipboardData?.items ?? []) {
            if (it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) { fileFromDrop(f); return; } }
        }
    }

    const m = model.current;
    let disp = m ? Math.min(MAX_PREVIEW / m.W, MAX_PREVIEW / m.H) : 1;
    // While dragging a canvas edge, hold the display scale steady so content keeps its on-screen
    // size and only the canvas boundary moves (paint-style). Re-fit once the drag ends.
    if (m && drag.current?.mode === "canvas") disp = drag.current.disp0;
    dispRef.current = disp;
    dirty.current = true;   // any React re-render (selection/edit/style change) → repaint once
    const st = selText();

    // While dragging a left/top edge, offset the (left/top-anchored) canvas so the OPPOSITE edge
    // stays visually pinned and the dragged grip tracks the cursor — real per-side crop feel.
    let tx = 0, ty = 0;
    const dc = drag.current;
    if (m && dc?.mode === "canvas") {
        if (dc.h === "l") tx = (dc.sW - m.W) * disp;
        if (dc.v === "t") ty = (dc.sH - m.H) * disp;
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.DYNAMIC}>
            <ModalHeader><Text variant="heading-lg/semibold">Caption editor</Text></ModalHeader>
            <ModalContent>
                <div onPaste={onPaste} style={{ display: "flex", gap: 16, padding: "12px 0", minHeight: 300, color: "var(--text-default, var(--text-normal, #dbdee1))" }}>
                    {!m ? (
                        <div
                            onClick={() => fileInput.current?.click()}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) fileFromDrop(f); }}
                            style={{
                                flex: 1, minWidth: 420, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                                gap: 8, minHeight: 280, border: "2px dashed var(--interactive-normal)", borderRadius: 10, cursor: "pointer",
                                color: "var(--text-default, var(--text-normal, #dbdee1))", textAlign: "center", padding: 24
                            }}
                        >
                            <div style={{ fontSize: 40 }}>🖼️</div>
                            <Text variant="text-md/semibold">Drag an image, gif or video here</Text>
                            <Text variant="text-sm/normal">or click to browse — you can also paste an image (Ctrl+V)</Text>
                            {error && <Text variant="text-sm/semibold" style={{ color: "var(--text-danger)" }}>{error}</Text>}
                        </div>
                    ) : (
                        <>
                            <div style={{ position: "relative", flex: "1 1 auto", minWidth: 0, display: "flex", justifyContent: "flex-start", alignItems: "flex-start" }}>
                                <div style={{ position: "relative", width: m.W * disp, height: m.H * disp, transform: tx || ty ? `translate(${tx}px, ${ty}px)` : undefined }}>
                                    <canvas
                                        ref={canvasEl}
                                        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onDouble as any}
                                        style={{
                                            width: m.W * disp, height: m.H * disp, touchAction: "none", cursor: "move",
                                            background: "repeating-conic-gradient(#808080 0% 25%, #a0a0a0 0% 50%) 50% / 16px 16px", borderRadius: 4
                                        }}
                                    />
                                    {editing && st && (
                                        <textarea
                                            autoFocus
                                            value={st.text}
                                            onChange={e => patch({ text: e.currentTarget.value })}
                                            onBlur={() => setEditing(null)}
                                            onKeyDown={e => { if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); setEditing(null); } }}
                                            style={{
                                                position: "absolute", left: st.t.cx * disp, top: st.t.cy * disp, transform: "translate(-50%,-50%)",
                                                width: Math.max(120, st.boxW * disp * st.t.scale), minHeight: 32, resize: "none", textAlign: "center",
                                                background: "rgba(0,0,0,.75)", color: "#fff", border: "1px solid #00a8fc", borderRadius: 4, padding: 4
                                            }}
                                        />
                                    )}
                                </div>
                            </div>

                            <div style={{ flex: "0 0 210px", display: "flex", flexDirection: "column", gap: 8 }}>
                                <Button size={Button.Sizes.SMALL} onClick={() => addText()}>+ Add text</Button>

                                <Forms.FormTitle style={{ marginBottom: 0 }}>Background</Forms.FormTitle>
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                    <input type="color" value={/^#/.test(m.bg) ? m.bg : "#ffffff"} onChange={e => { m.bg = e.currentTarget.value; rerender(); }} />
                                    <Button size={Button.Sizes.MIN} look={Button.Looks.LINK} onClick={() => { m.bg = "transparent"; rerender(); }}>transparent</Button>
                                </div>

                                {st ? (
                                    <>
                                        <Forms.FormDivider />
                                        <Forms.FormTitle style={{ marginBottom: 0 }}>Text</Forms.FormTitle>
                                        <select value={Object.keys(FONT_STACKS).find(k => FONT_STACKS[k] === st.font) ?? "Impact"} onChange={e => patch({ font: FONT_STACKS[e.currentTarget.value] })}>
                                            {Object.keys(FONT_STACKS).map(k => <option key={k} value={k}>{k}</option>)}
                                        </select>
                                        <div style={{ display: "flex", gap: 6 }}>
                                            <Button size={Button.Sizes.MIN} color={st.bold ? Button.Colors.BRAND : Button.Colors.PRIMARY} onClick={() => patch({ bold: !st.bold })}><b>B</b></Button>
                                            <Button size={Button.Sizes.MIN} color={st.italic ? Button.Colors.BRAND : Button.Colors.PRIMARY} onClick={() => patch({ italic: !st.italic })}><i>I</i></Button>
                                            {(["left", "center", "right"] as const).map(a =>
                                                <Button key={a} size={Button.Sizes.MIN} color={st.align === a ? Button.Colors.BRAND : Button.Colors.PRIMARY} onClick={() => patch({ align: a })}>{a[0].toUpperCase()}</Button>)}
                                        </div>
                                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                            <span style={{ fontSize: 12 }}>Fill</span>
                                            <input type="color" value={st.color} onChange={e => patch({ color: e.currentTarget.value })} />
                                            <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
                                                <input type="checkbox" checked={!!st.highlight} onChange={e => patch({ highlight: e.currentTarget.checked ? "#000000" : undefined })} />bg
                                            </label>
                                            {st.highlight && <input type="color" value={st.highlight} onChange={e => patch({ highlight: e.currentTarget.value })} />}
                                        </div>
                                        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                                            <input type="checkbox" checked={st.outline} onChange={e => patch({ outline: e.currentTarget.checked })} /> Outline
                                        </label>
                                        {st.outline && <input type="range" min={0} max={30} value={Math.round(st.outlineW * 100)} onChange={e => patch({ outlineW: Number(e.currentTarget.value) / 100 })} />}
                                        <span style={{ fontSize: 12 }}>Font size</span>
                                        <input type="range" min={8} max={200} value={Math.round(st.fontPx)} onChange={e => patch({ fontPx: Number(e.currentTarget.value) })} />
                                        <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={deleteSel}>Delete text</Button>
                                    </>
                                ) : <span style={{ fontSize: 12, lineHeight: "16px" }}>Drag to move · corner = resize · top dot = rotate · white edge squares = crop/extend the canvas · double-click empty space to add text, or a text box to edit it.</span>}
                            </div>
                        </>
                    )}
                    <input ref={fileInput} type="file" accept="image/*,video/*" style={{ display: "none" }}
                        onChange={e => { const f = e.currentTarget.files?.[0]; if (f) fileFromDrop(f); }} />
                </div>
            </ModalContent>
            <ModalFooter>
                <Button style={{ marginLeft: 12 }} disabled={busy || !m} onClick={addToMessage}>{busy ? "Rendering…" : "Add to message"}</Button>
                <Button color={Button.Colors.TRANSPARENT} look={Button.Looks.LINK} onClick={modalProps.onClose}>Cancel</Button>
            </ModalFooter>
        </ModalRoot>
    );
}

export function openCaptionEditor(source?: { blob: Blob; ext: string; }): void {
    openModal(props => <Editor initial={source ?? null} modalProps={props} />);
}
