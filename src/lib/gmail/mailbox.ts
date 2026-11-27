/** Gmail ignores dots and "+tags" in gmail.com addresses, so f.cody+jobs@gmail.com is fcody@gmail.com. */
export function sameMailbox(a: string, b: string) {
  const canonical = (address: string) => {
    const [local = "", domain = ""] = address.trim().toLowerCase().split("@");
    const gmail = domain === "gmail.com" || domain === "googlemail.com";
    return `${gmail ? local.split("+")[0].replace(/\./g, "") : local}@${gmail ? "gmail.com" : domain}`;
  };
  return canonical(a) === canonical(b);
}

export type GmailConnection = { label: "Connected" | "Not connected" | "Reconnect" | "Error"; tone: "good" | "bad" | "neutral"; hint?: string };

/** The connection status of a profile Gmail, as shown in Administrator -> Users and -> Gmail. */
export function gmailConnection(profileEmail: string, connectedEmail: string | null, lastError: string | null): GmailConnection {
  if (!connectedEmail) return { label: "Not connected", tone: "neutral" };
  if (!sameMailbox(connectedEmail, profileEmail)) return { label: "Reconnect", tone: "bad", hint: `The profile's Gmail changed; ${connectedEmail} is connected.` };
  if (lastError) return { label: "Error", tone: "bad", hint: lastError };
  return { label: "Connected", tone: "good" };
}

/** A link that opens this message in Gmail on the web, in the right account. */
export function gmailLink(accountEmail: string, messageId: string) {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${encodeURIComponent(messageId)}`;
}
