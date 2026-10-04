/**
 * While the Host Messages page (host.html) is started it "claims" the MIDI pads,
 * so a pad press plays a host message instead of also firing a dashboard sound.
 * The pages talk over a BroadcastChannel (same browser only). The claim is a
 * heartbeat, so it lapses on its own if the host window closes without Stop.
 */
const CHANNEL_NAME = 'strudel-host-midi';
const HEARTBEAT_MS = 1000;
const EXPIRY_MS = 3000;

let channel = null;
const getChannel = () => {
  if (!channel && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
};

/** Host page: claim the pads until the returned release function is called (or the page goes away). */
export function claimPads() {
  const send = (type) => getChannel()?.postMessage({ type });
  send('claim');
  const timer = setInterval(() => send('claim'), HEARTBEAT_MS);
  const release = () => {
    clearInterval(timer);
    window.removeEventListener('pagehide', release);
    send('release');
  };
  window.addEventListener('pagehide', release);
  return release;
}

let lastClaimAt = 0;

/** Dashboard: true while a started host page holds the pads. */
export const arePadsClaimed = () => Date.now() - lastClaimAt <= EXPIRY_MS;

/** Dashboard: start listening for claims; onChange(claimed) fires when the state flips. */
export function watchPadClaim(onChange) {
  const ch = getChannel();
  if (!ch) return;
  let claimed = false;
  const update = () => {
    if (arePadsClaimed() !== claimed) {
      claimed = !claimed;
      onChange?.(claimed);
    }
  };
  ch.addEventListener('message', (e) => {
    if (e.data?.type === 'claim') lastClaimAt = Date.now();
    else if (e.data?.type === 'release') lastClaimAt = 0;
    update();
  });
  setInterval(update, 500); // notices a host window that vanished without releasing
}
