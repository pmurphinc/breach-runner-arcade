"use client";

/**
 * The Custom touch-layout editor.
 *
 * Direct manipulation first, numbers second: the player drags a control to move
 * it and drags its edge to resize, and the numeric fields beside the preview
 * update as they go. Those fields carry their own valid range in the label,
 * because the range is the only cue for how far a control can actually travel —
 * a slider that silently stops tells the player nothing about why.
 *
 * Edits run against a working copy. Save commits it, Close throws it away. That
 * matters more here than in most settings screens: a half-finished layout can
 * leave a control somewhere the player cannot reach, and the way out of that
 * should not be "reconstruct your old layout from memory".
 *
 * Kept out of game.tsx deliberately (Master rule 42) — it is self-contained UI
 * over a pure model, and the game loop has no business knowing about it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type CustomTouchLayout,
  type TouchElementId,
  TOUCH_ELEMENT_IDS,
  TOUCH_ELEMENT_LABELS,
  TOUCH_ELEMENT_RANGES,
  clampTouchElement,
  defaultCustomTouchLayout,
  isTouchStick,
  mirrorCustomTouchLayout,
  parseCustomTouchLayout,
  serializeCustomTouchLayout,
  touchElementEdge,
} from "./touch-profiles";

type FieldId = "size" | "x" | "y" | "deadzone";

const FIELD_LABELS: Record<FieldId, string> = {
  size: "⌀",
  x: "x →centre",
  y: "y ↓",
  deadzone: "dead ⌀",
};

function fieldRange(element: TouchElementId, field: FieldId): readonly [number, number] {
  if (field === "size") return TOUCH_ELEMENT_RANGES.size[element];
  if (field === "deadzone") return TOUCH_ELEMENT_RANGES.deadzone;
  return TOUCH_ELEMENT_RANGES[field];
}

/** Sticks expose a dead zone; buttons have nothing to put in that field. */
function fieldsFor(element: TouchElementId): FieldId[] {
  return isTouchStick(element) ? ["size", "deadzone", "x", "y"] : ["size", "x", "y"];
}

export function TouchLayoutEditor({
  layout,
  onSave,
  onClose,
}: {
  layout: CustomTouchLayout;
  onSave: (next: CustomTouchLayout) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CustomTouchLayout>(layout);
  const [selected, setSelected] = useState<TouchElementId>("move");
  const [transfer, setTransfer] = useState<"import" | "export" | null>(null);
  const [transferText, setTransferText] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);

  // Escape is the reflex for "get me out of this overlay", and it must discard
  // rather than commit — the same rule as the Close button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const geometry = draft.elements[selected];

  const setField = useCallback(
    (field: FieldId, value: number) => {
      setDraft((current) => ({
        ...current,
        elements: {
          ...current.elements,
          [selected]: clampTouchElement(selected, { ...current.elements[selected], [field]: value }),
        },
      }));
    },
    [selected]
  );

  /**
   * Drag to move, or drag the handle to resize.
   *
   * Pointer capture rather than window listeners so a fast drag that leaves the
   * element still tracks, and so a lost pointer (a call arriving, the browser
   * stealing focus) ends the gesture instead of leaving it stuck live.
   *
   * x is negated against the element's own edge: dragging left increases x for a
   * right-anchored control and decreases it for a left-anchored one, so the
   * control always follows the finger regardless of which side it lives on.
   */
  const beginDrag = useCallback(
    (event: React.PointerEvent, mode: "move" | "resize") => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startY = event.clientY;
      const start = draft.elements[selected];
      const inward = touchElementEdge(selected, draft.handed) === "right" ? -1 : 1;

      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (mode === "move") {
          setDraft((current) => ({
            ...current,
            elements: {
              ...current.elements,
              [selected]: clampTouchElement(selected, {
                ...current.elements[selected],
                x: start.x + dx * inward,
                y: start.y + dy,
              }),
            },
          }));
        } else {
          // Resize from the centre: the larger of the two axes wins so the
          // gesture works whichever way the finger travels.
          const delta = Math.abs(dx) > Math.abs(dy) ? dx * inward : dy;
          setDraft((current) => ({
            ...current,
            elements: {
              ...current.elements,
              [selected]: clampTouchElement(selected, {
                ...current.elements[selected],
                size: start.size + delta * 2,
              }),
            },
          }));
        }
      };
      const onEnd = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onEnd);
        target.removeEventListener("pointercancel", onEnd);
        target.removeEventListener("lostpointercapture", onEnd);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onEnd);
      target.addEventListener("pointercancel", onEnd);
      target.addEventListener("lostpointercapture", onEnd);
    },
    [draft, selected]
  );

  return (
    <div className="touch-editor" role="dialog" aria-modal="true" aria-label="Custom touch layout">
      <header className="touch-editor-head">
        <div>
          <b>{draft.handed === "right" ? "Right-handed, steering on the left" : "Left-handed, steering on the right"}</b>
          <small>Drag to move · drag the handle to resize · x runs toward the screen centre, y down.</small>
        </div>
        <div className="touch-editor-head-actions">
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" className="primary" onClick={() => onSave(draft)}>Save</button>
        </div>
      </header>

      <div className="touch-editor-tabs" role="tablist" aria-label="Control to edit">
        {TOUCH_ELEMENT_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected === id}
            className={selected === id ? "active" : ""}
            onClick={() => setSelected(id)}
          >
            {TOUCH_ELEMENT_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="touch-editor-fields">
        {fieldsFor(selected).map((field) => {
          const [min, max] = fieldRange(selected, field);
          return (
            <label key={field} className="touch-editor-field">
              <span>
                {FIELD_LABELS[field]} <em>{min}…{max}</em>
              </span>
              <input
                type="number"
                min={min}
                max={max}
                value={geometry[field]}
                onChange={(event) => setField(field, Number(event.target.value))}
              />
            </label>
          );
        })}
      </div>

      {/* Live preview. Every element is drawn where the layout puts it, so the
          player is adjusting the real arrangement rather than a diagram. */}
      <div className="touch-editor-stage" ref={stageRef}>
        {TOUCH_ELEMENT_IDS.map((id) => {
          const element = draft.elements[id];
          const edge = touchElementEdge(id, draft.handed);
          const active = id === selected;
          return (
            <div
              key={id}
              className={`touch-editor-ghost ${active ? "active" : ""} ${isTouchStick(id) ? "stick" : "button"}`}
              style={{
                width: element.size,
                height: element.size,
                [edge]: element.x,
                top: `calc(50% + ${element.y}px)`,
              } as React.CSSProperties}
              onPointerDown={(event) => {
                setSelected(id);
                if (active) beginDrag(event, "move");
              }}
            >
              <span className="touch-editor-ghost-name">{TOUCH_ELEMENT_LABELS[id]}</span>
              {isTouchStick(id) && element.deadzone > 0 ? (
                <span
                  className="touch-editor-deadzone"
                  style={{ width: element.deadzone, height: element.deadzone }}
                  aria-hidden="true"
                />
              ) : null}
              {active ? (
                <span
                  className="touch-editor-handle"
                  role="slider"
                  tabIndex={0}
                  aria-label={`Resize ${TOUCH_ELEMENT_LABELS[id]}`}
                  aria-valuenow={element.size}
                  aria-valuemin={fieldRange(id, "size")[0]}
                  aria-valuemax={fieldRange(id, "size")[1]}
                  onPointerDown={(event) => beginDrag(event, "resize")}
                  onKeyDown={(event) => {
                    // Keyboard resize, so this is not pointer-only.
                    if (event.key === "ArrowUp" || event.key === "ArrowRight") setField("size", element.size + 4);
                    if (event.key === "ArrowDown" || event.key === "ArrowLeft") setField("size", element.size - 4);
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {transfer ? (
        <div className="touch-editor-transfer">
          <label>
            <span>{transfer === "export" ? "Copy this layout" : "Paste a layout"}</span>
            <textarea
              value={transferText}
              readOnly={transfer === "export"}
              onChange={(event) => setTransferText(event.target.value)}
              rows={5}
              spellCheck={false}
            />
          </label>
          <div className="touch-editor-transfer-actions">
            <button type="button" onClick={() => setTransfer(null)}>Cancel</button>
            {transfer === "import" ? (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setDraft(parseCustomTouchLayout(transferText));
                  setTransfer(null);
                }}
              >
                Apply
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <footer className="touch-editor-foot">
        <button type="button" onClick={() => setDraft(mirrorCustomTouchLayout(draft))}>
          ⇄ {draft.handed === "right" ? "Right" : "Left"}
        </button>
        <button
          type="button"
          onClick={() => {
            setTransferText("");
            setTransfer("import");
          }}
        >
          Import
        </button>
        <button
          type="button"
          onClick={() => {
            setTransferText(serializeCustomTouchLayout(draft));
            setTransfer("export");
          }}
        >
          Export
        </button>
        <button type="button" onClick={() => setDraft(defaultCustomTouchLayout())}>Reset</button>
      </footer>
    </div>
  );
}
