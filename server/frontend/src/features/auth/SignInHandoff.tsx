import { useLayoutEffect } from "react";

import { clearSignInDeparture, peekSignInDeparture, type SignInDeparture } from "./signin-handoff";

/** Travel: a soft departure, clear travel and a long, soft arrival. */
const TRAVEL = "cubic-bezier(0.45, 0, 0.1, 1)";
/** Things arriving from nowhere. */
const ARRIVE = "cubic-bezier(0.25, 0.8, 0.25, 1)";
const FLIGHT_MS = 680;
const ARRIVE_MS = 520;
const STAGGER_MS = 60;

/**
 * The sign-in moment. The dashboard is already mounted and usable; this only
 * dresses its arrival. Header then content rise into place in reading order,
 * while a disc lifts off the control that was pressed (its fill, its icon),
 * travels to the header and lands as the person's avatar, taking the avatar's
 * look over the last third so the hand-off frame is identical to the real one.
 * Nothing takes input and nothing pulses on landing. Reduced motion: the
 * dashboard fades in and the avatar is simply there.
 */
export function SignInHandoff({ onDone }: { onDone: () => void }) {
  useLayoutEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const running: Animation[] = [];
    const cleanups: Array<() => void> = [];

    // Measure the landing spot before the header's own arrival moves it.
    const departure = peekSignInDeparture();
    const target = document.querySelector<HTMLElement>("[data-signin-target]");
    if (!reduce && departure && target) {
      cleanups.push(fly(departure, target, running));
    }

    document.querySelectorAll<HTMLElement>("[data-signin-arrive]").forEach((region, index) => {
      running.push(
        region.animate(
          reduce
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
                { opacity: 0, transform: "translateY(8px)" },
                { opacity: 1, transform: "none" },
              ],
          {
            duration: reduce ? 160 : ARRIVE_MS,
            delay: reduce ? 0 : index * STAGGER_MS,
            easing: ARRIVE,
            fill: "backwards",
          },
        ),
      );
    });

    // A run that was cleaned up (unmount, StrictMode's rehearsal) cancels its
    // animations, which settles their promises; it must not report done.
    let active = true;
    const finish = () => {
      if (!active) return;
      active = false;
      onDone();
    };
    void Promise.allSettled(running.map((animation) => animation.finished)).then(finish);

    return () => {
      active = false;
      running.forEach((animation) => animation.cancel());
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [onDone]);

  return null;
}

function fly(
  departure: SignInDeparture,
  target: HTMLElement,
  running: Animation[],
): () => void {
  const to = target.getBoundingClientRect();
  const face = target.querySelector<HTMLElement>("[data-slot=avatar-fallback]") ?? target;
  const look = getComputedStyle(face);
  const from = departure.rect;

  // The disc is laid out at the avatar's exact size and place, so the last
  // frame is the real avatar; the flight is a transform back from take-off.
  const takeOff = Math.max(from.width, from.height) + 16;
  const scale = takeOff / to.width;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);

  const disc = document.createElement("div");
  disc.setAttribute("aria-hidden", "true");
  Object.assign(disc.style, {
    position: "fixed",
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`,
    borderRadius: "9999px",
    pointerEvents: "none",
    zIndex: "60",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
  } satisfies Partial<CSSStyleDeclaration>);

  // Two faces in one slot: the button's look leaving, the avatar's arriving.
  const leaving = document.createElement("div");
  Object.assign(leaving.style, {
    gridArea: "1 / 1",
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
    background: departure.background,
    color: departure.color,
  } satisfies Partial<CSSStyleDeclaration>);
  if (departure.icon) {
    const icon = departure.icon.cloneNode(true) as SVGElement;
    const iconSize = Math.max(from.width, from.height) / scale;
    Object.assign(icon.style, { width: `${iconSize}px`, height: `${iconSize}px` });
    leaving.append(icon);
  }

  const arriving = document.createElement("div");
  Object.assign(arriving.style, {
    gridArea: "1 / 1",
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
    background: look.backgroundColor,
    color: look.color,
    font: look.font,
    letterSpacing: look.letterSpacing,
    opacity: "0",
  } satisfies Partial<CSSStyleDeclaration>);
  arriving.textContent = face.textContent;

  disc.append(arriving, leaving);
  document.body.append(disc);

  const timing = { duration: FLIGHT_MS, easing: TRAVEL, fill: "both" } as const;
  const flight = disc.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
      { transform: "none" },
    ],
    timing,
  );
  // The real avatar waits out the flight; an animation, so a re-render can't undo it.
  const waiting = target.animate([{ opacity: 0 }, { opacity: 0 }], { duration: FLIGHT_MS });
  running.push(
    flight,
    // The resting look arrives over the last third, never on the landing frame.
    leaving.animate([{ opacity: 1 }, { opacity: 1, offset: 0.62 }, { opacity: 0 }], {
      ...timing,
      easing: "linear",
    }),
    arriving.animate([{ opacity: 0 }, { opacity: 0, offset: 0.62 }, { opacity: 1 }], {
      ...timing,
      easing: "linear",
    }),
  );

  const tidy = () => {
    waiting.cancel();
    disc.remove();
  };
  // A finished flight lands and is done; a cancelled one (unmount, StrictMode's
  // rehearsal) only tidies, leaving the departure for the run that follows.
  void flight.finished.then(() => {
    tidy();
    clearSignInDeparture();
  }, tidy);
  return tidy;
}
