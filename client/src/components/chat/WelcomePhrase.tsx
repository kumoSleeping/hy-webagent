import { useState } from "react";
import { pickWelcomePhrase } from "../../lib/welcomePhrases";

export function WelcomePhrase() {
  const [phrase] = useState(pickWelcomePhrase);

  return (
    <div className="pi-welcome-phrase-area" aria-hidden="true">
      <div className="pi-welcome-phrase-inner">
        <p className="pi-welcome-phrase">{phrase}</p>
      </div>
    </div>
  );
}
