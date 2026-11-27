import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertPublic, privateIp } from "../src/lib/tailor/public-address.ts";

describe("privateIp", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1"]) {
    it(`blocks ${ip}`, () => assert.equal(privateIp(ip), true));
  }

  for (const ip of ["::ffff:10.0.0.1", "::ffff:127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::"]) {
    it(`blocks the IPv4 inside ${ip}`, () => assert.equal(privateIp(ip), true));
  }

  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    it(`allows ${ip}`, () => assert.equal(privateIp(ip), false));
  }

  it("treats something that is not an address as blocked", () => assert.equal(privateIp("not-an-ip"), true));
});

describe("assertPublic", () => {
  for (const url of ["http://localhost/jobs", "http://printer.local/", "http://10.0.0.5/", "http://[::1]/", "http://169.254.169.254/latest/meta-data"]) {
    it(`refuses ${url}`, () => assert.rejects(assertPublic(url), /not a public job page/));
  }

  it("refuses other protocols", () => assert.rejects(assertPublic("ftp://example.com/"), /Only public http and https/));

  it("allows a public IP literal without a DNS lookup", () => assertPublic("https://8.8.8.8/careers"));
});
