import { Link } from "react-router-dom";

interface PlatformSignatureProps {
  showLogout?: boolean;
  docked?: boolean;
}

export function PlatformSignature({ showLogout = false, docked = false }: PlatformSignatureProps) {
  return (
    <p className={`pi-platform-signature${docked ? " pi-platform-signature--docked" : ""}`}>
      HY-Webagent | kumoSleeping@2026 | QGI Project
      {showLogout && (
        <>
          {" | "}
          <Link to="/logout" className="pi-platform-signature-action">
            Logout
          </Link>
        </>
      )}
    </p>
  );
}
