import { useEffect, useState } from "react";
import startupHandsBackground from "../../assets/startup-hands-background-v2.png";
import startupHandsForeground from "../../assets/startup-hands-foreground-small-v4.png";
import startupHumanForeground from "../../assets/startup-human-continuous-v1.png";
import splashLogo from "../../assets/agents-one-splash.svg";
import { startupSceneStyle } from "./startup-scene";

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
    <div className="splash-screen" style={startupSceneStyle}>
      <img
        className="splash-hand-background"
        src={startupHandsBackground}
        alt=""
      />
      <div className="splash-hand-stage">
        <div className="splash-hand-canvas">
          <div className="splash-hands">
            <img
              className="splash-hand-layer splash-hand-robot"
              src={startupHandsForeground}
              alt=""
            />
            <div className="splash-human-motion">
              <img
                className="splash-hand-layer splash-hand-human"
                src={startupHumanForeground}
                alt=""
              />
            </div>
          </div>
          <div className="splash-contact" aria-hidden="true">
            <span className="splash-contact-core" />
          </div>
          <img className="splash-logo" src={splashLogo} alt="Agents One" />
        </div>
      </div>
      <div className="splash-vignette" aria-hidden="true" />
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
