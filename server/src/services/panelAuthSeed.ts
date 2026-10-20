// The initial panel account, created on the first start while no login exists. Its
// password was handed to the owner privately; only the scrypt hash is here. Signed in
// with it, the panel does nothing but replace it: a new username and password and an
// authenticator app (panelAuth.ts, mustChange). Used once: after a reset (deleting
// server/data/auth.json) the setup asks for the setup code or secret key instead.
export const INITIAL_ACCOUNT = {
  username: "admin",
  passwordHash: "scrypt$32768$8$1$N+JwFkZaY0MTnULVEGOAkA==$cgnbOkF9ys5q5Lqjpgm27jEL+FqWr7R5KLyN7ZDnp5o=",
};
