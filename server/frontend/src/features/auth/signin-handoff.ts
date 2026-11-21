/**
 * The sign-in hand-off: the control someone pressed to sign in becomes their
 * avatar in the header. The login page remembers that control; the moment the
 * session is applied (while the login page is still on screen) its icon and
 * colours are captured, and the app shell flies a disc from there to the
 * header avatar.
 */

export interface SignInDeparture {
  /** Where the pressed control's icon sat on screen. */
  rect: DOMRect;
  /** A copy of that icon, carried by the disc until it lands. */
  icon: SVGElement | null;
  /** The pressed control's own fill and ink, the disc's look at take-off. */
  background: string;
  color: string;
}

let lastControl: Element | null = null;
let departure: SignInDeparture | null = null;

/** Remember the control a sign-in started from (the pressed button, or the form's submit). */
export function rememberSignInControl(control: Element | null) {
  lastControl = control;
}

/** Capture the take-off point. Called as the session is applied, before the login page unmounts. */
export function measureSignInDeparture() {
  const control = lastControl?.isConnected ? lastControl : null;
  lastControl = null;
  departure = null;
  if (!control) return;
  const svg = control.querySelector("svg");
  const rect = (svg ?? control).getBoundingClientRect();
  if (rect.width === 0) return;
  const style = getComputedStyle(control);
  departure = {
    rect,
    icon: svg ? (svg.cloneNode(true) as SVGElement) : null,
    background: style.backgroundColor,
    color: style.color,
  };
}

/**
 * The captured take-off point, or null when the sign-in did not come from a
 * remembered control. Reading does not consume it, so an effect that runs
 * twice (React's StrictMode) still finds it; the flight clears it on landing.
 */
export function peekSignInDeparture(): SignInDeparture | null {
  return departure;
}

export function clearSignInDeparture() {
  departure = null;
}
