"use client";

import { useEffect, useId, useRef } from "react";

// A modal window built on the native dialog element, which already traps focus, keeps the page
// behind it inert and closes on Escape. This adds the rest: a click on the backdrop closes it,
// focus lands on the element marked data-autofocus (or the first control), and focus goes back
// to where it was when the window closes.
export function Dialog({
  open,
  onClose,
  title,
  children,
  restoreFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  // Where focus goes on close, when the opener no longer exists.
  restoreFocus?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const restore = useRef(restoreFocus);

  useEffect(() => {
    restore.current = restoreFocus;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;

    const opener = document.activeElement as HTMLElement | null;

    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    // The page behind a modal dialog can still scroll, which is disorienting.
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "";
      dialog.close();

      if (restore.current) restore.current();
      else if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Escape fires "cancel". Closing is left to the parent, so its state stays the truth.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // The dialog fills its own box, so a click that lands on the dialog itself hit the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-3rem)] max-w-lg overflow-visible bg-transparent p-0 text-slate backdrop:bg-forest/60"
    >
      {open && (
        <div className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface p-5 pixel-frame sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="font-pixel text-4xl leading-[0.9] text-forest">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center bg-surface text-forest ring-2 ring-fern ring-inset hover:ring-emerald"
            >
              <svg
                viewBox="0 0 7 7"
                className="size-4 fill-current"
                shapeRendering="crispEdges"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M0 0h2v1H0zM5 0h2v1H5zM1 1h2v1H1zM4 1h2v1H4zM2 2h3v1H2zM3 3h1v1H3zM2 4h3v1H2zM1 5h2v1H1zM4 5h2v1H4zM0 6h2v1H0zM5 6h2v1H5z" />
              </svg>
            </button>
          </div>
          <div className="mt-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
