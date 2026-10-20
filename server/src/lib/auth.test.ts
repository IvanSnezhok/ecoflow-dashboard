import assert from "node:assert/strict";
import { parseCookies } from "./cookies.js";
import { hashPassword, verifyPassword } from "./password.js";
import { canAccessDevice, canControl, isMemberRole, isOwner, parseDeviceList, type PanelUser } from "./permissions.js";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpAt, totpCounter, verifyTotp } from "./totp.js";

// RFC 4648 base32
assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
assert.equal(base32Decode("MZXW6YTBOI").toString(), "foobar");
assert.equal(base32Decode("mzxw 6ytb-oi======").toString(), "foobar");
assert.throws(() => base32Decode("1"));

// RFC 6238 appendix B, SHA-1, 8 digits
const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));
for (const [seconds, code] of [[59, "94287082"], [1111111109, "07081804"], [1234567890, "89005924"], [2000000000, "69279037"]] as const) {
  assert.equal(totpAt(rfcSecret, totpCounter(seconds * 1000), 8), code);
}
assert.equal(totpAt(rfcSecret, totpCounter(59_000)), "287082", "6 digits are the last six");

// Verification: one step of drift either way, each code once
const secret = generateTotpSecret();
assert.equal(base32Decode(secret).length, 20);
const now = 1_800_000_000_000;
const step = totpCounter(now);
assert.equal(verifyTotp(secret, totpAt(secret, step), now), step);
assert.equal(verifyTotp(secret, totpAt(secret, step - 1), now), step - 1);
assert.equal(verifyTotp(secret, totpAt(secret, step + 1), now), step + 1);
assert.equal(verifyTotp(secret, totpAt(secret, step - 2), now), null);
assert.equal(verifyTotp(secret, totpAt(secret, step), now, step), null, "a used code is refused");
assert.equal(verifyTotp(secret, ` ${totpAt(secret, step).slice(0, 3)} ${totpAt(secret, step).slice(3)} `, now), step);
assert.equal(verifyTotp(secret, "12345", now), null);
assert.equal(verifyTotp(secret, "abcdef", now), null);

const uri = new URL(otpauthUri("JBSWY3DPEHPK3PXP", "ivan", "EcoFlow panel"));
assert.equal(uri.protocol, "otpauth:");
assert.equal(uri.host, "totp");
assert.equal(decodeURIComponent(uri.pathname), "/EcoFlow panel:ivan");
assert.equal(uri.searchParams.get("secret"), "JBSWY3DPEHPK3PXP");
assert.equal(uri.searchParams.get("issuer"), "EcoFlow panel");

// scrypt hashes: salted, verifiable, wrong passwords refused
const hash = await hashPassword("correct horse battery");
assert.match(hash, /^scrypt\$32768\$8\$1\$/);
assert.notEqual(hash, await hashPassword("correct horse battery"));
assert.equal(await verifyPassword("correct horse battery", hash), true);
assert.equal(await verifyPassword("correct horse batterY", hash), false);
assert.equal(await verifyPassword("anything", "md5$abc"), false);

assert.deepEqual(parseCookies("a=1; ecoflow_session=abc%3D%3D; broken; =x; b=%E0"), { a: "1", ecoflow_session: "abc==" });
assert.deepEqual(parseCookies(undefined), {});

// Roles: the owner sees and changes everything; invited users only their devices
const owner: PanelUser = { id: "owner", username: "ivan", role: "owner", devices: null };
const operator: PanelUser = { id: "a1", username: "olha", role: "operator", devices: ["DAEBZ5KF1182943"] };
const viewer: PanelUser = { id: "b2", username: "petro", role: "viewer", devices: null };
assert.equal(isOwner(owner), true);
assert.equal(isOwner(operator), false);
assert.equal(canAccessDevice(owner, "ANY0001"), true);
assert.equal(canAccessDevice(operator, "DAEBZ5KF1182943"), true);
assert.equal(canAccessDevice(operator, "DCABZ8ZE5130001"), false, "only the devices given");
assert.equal(canAccessDevice(viewer, "DCABZ8ZE5130001"), true, "null = every device");
assert.equal(canControl(owner), true);
assert.equal(canControl(operator), true);
assert.equal(canControl(viewer), false);
assert.equal(isMemberRole("viewer"), true);
assert.equal(isMemberRole("operator"), true);
assert.equal(isMemberRole("owner"), false, "nobody is invited as owner");
assert.equal(isMemberRole(undefined), false);

assert.equal(parseDeviceList(null), null);
assert.deepEqual(parseDeviceList(["DAEBZ5KF1182943", "DAEBZ5KF1182943", "DCABZ8ZE5130001"]), ["DAEBZ5KF1182943", "DCABZ8ZE5130001"]);
assert.equal(parseDeviceList([]), undefined, "at least one device");
assert.equal(parseDeviceList(undefined), undefined);
assert.equal(parseDeviceList("DAEBZ5KF1182943"), undefined);
assert.equal(parseDeviceList(["../etc"]), undefined);
assert.equal(parseDeviceList([42]), undefined);
console.log("Panel login tests passed");
