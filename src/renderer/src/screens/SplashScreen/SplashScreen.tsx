import { useEffect, useState } from "react";
import startupHandsBackground from "../../assets/startup-hands-background-v2.png";
import startupHumanHand from "../../assets/startup-human-hand-alpha-v2.png";
import startupRobotHand from "../../assets/startup-robot-hand-alpha-v2.png";
import splashLogo from "../../assets/agents-one-splash.svg";

interface SplashScreenProps {
  onFinished: () => void;
  status?: string;
  // When provided, a "Switch to local mode" escape hatch appears after a delay
  // so a stuck remote connect never traps the user on the splash. Omitted in
  // local mode.
  onSwitchToLocal?: () => void;
}

// How long the splash may sit on a remote/SSH step before we offer the escape
// hatch. Long enough that a normal first-connect (gateway provisioning, dist
// build, health waits) isn't interrupted, short enough to rescue a hang.
const ESCAPE_HATCH_DELAY_MS = 12000;

// @lat: [[brand-startup#Startup brand animation]]
function SplashScreen({
  onFinished,
  status,
  onSwitchToLocal,
}: SplashScreenProps): React.JSX.Element {
  const [showEscape, setShowEscape] = useState(false);
  // Stable boolean so the timer below isn't reset every time the parent
  // re-renders and passes a fresh onSwitchToLocal function identity.
  const canSwitch = Boolean(onSwitchToLocal);

  useEffect(() => {
    onFinished();
  }, [onFinished]);

  useEffect(() => {
    if (!canSwitch) return;
    const timer = setTimeout(() => setShowEscape(true), ESCAPE_HATCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [canSwitch]);

  return (
    <div className="splash-screen">
      <div className="splash-hand-stage" aria-hidden="true">
        <img
          className="splash-hand-background"
          src={startupHandsBackground}
          alt=""
        />
        <img
          className="splash-hand-layer splash-hand-robot"
          src={startupRobotHand}
          alt=""
        />
        <img
          className="splash-hand-layer splash-hand-human"
          src={startupHumanHand}
          alt=""
        />
        <div className="splash-vignette" />
      </div>
      <div className="splash-contact" aria-hidden="true">
        <span className="splash-contact-core" />
      </div>
      <img className="splash-logo" src={splashLogo} alt="Agents One" />
      {onSwitchToLocal && showEscape && (
        <div className="splash-escape">
          <span className="splash-escape-hint">Taking longer than usual?</span>
          <button type="button" onClick={onSwitchToLocal}>
            Switch to local mode
          </button>
        </div>
      )}
      {status && <div className="splash-status">{status}</div>}
    </div>
  );
}

export default SplashScreen;
