import { Link } from "react-router-dom";

export function LogoutSlot() {
  return (
    <Link to="/logout" className="pi-web-chrome-action">
      Logout
    </Link>
  );
}
