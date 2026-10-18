"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PixelIcon } from "@/components/pixel-icons";

export type KebabItem = {
  label: string;
  onSelect: () => void;
  // Red text, for actions that cannot be undone.
  danger?: boolean;
  // Makes the item a tick box. True shows it ticked and false shows it empty.
  checked?: boolean;
};

// A triple-dot button that opens a short list of actions. Arrow keys move through the list,
// Escape closes it and returns focus to the button, and a click anywhere else closes it.
export function KebabMenu({
  label,
  items,
  disabled = false,
  open: controlledOpen,
  onOpenChange,
}: {
  // Names the button for screen readers, such as "Actions for Friday night".
  label: string;
  items: KebabItem[];
  disabled?: boolean;
  // Optional. Lets the page open the menu some other way, such as a right click on a card.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInnerOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);

  // Opening the menu puts focus on its first action, so the keyboard can carry on from there.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onMenuKeyDown(event: React.KeyboardEvent) {
    const buttons = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[(at + 1) % buttons.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
    } else if (event.key === "Tab") {
      // Tabbing out of a menu closes it, like a native one.
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) close();
        }}
        className="flex size-11 cursor-pointer items-center justify-center text-forest hover:bg-mint disabled:opacity-60"
      >
        {/* Three square dots, drawn on the pixel grid. */}
        <svg
          viewBox="0 0 8 8"
          className="size-6 fill-current"
          shapeRendering="crispEdges"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M3 0h2v2H3zM3 3h2v2H3zM3 6h2v2H3z" />
        </svg>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-20 mt-1 w-max min-w-44 max-w-72 bg-surface p-1 pixel-frame"
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left font-semibold hover:bg-mint focus-visible:bg-mint ${
                item.danger ? "text-danger" : "text-forest"
              }`}
            >
              {item.checked !== undefined && (
                <span
                  aria-hidden="true"
                  className={`flex size-5 shrink-0 items-center justify-center ring-2 ring-forest ring-inset ${
                    item.checked ? "bg-forest text-surface" : "bg-surface"
                  }`}
                >
                  {item.checked && <PixelIcon name="check" className="size-4" />}
                </span>
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
