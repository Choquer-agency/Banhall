/**
 * Company contacts (2026-11-04, the company profile: People). The checks the
 * Add person and Edit person dialog runs before it saves, and that
 * convex/companyContacts.ts runs again on the server. First name, last name,
 * role and email are required; an email must look like one; the phone is
 * optional.
 */

export const CONTACT_NAME_MAX_CHARS = 100;
export const CONTACT_ROLE_MAX_CHARS = 100;
export const CONTACT_EMAIL_MAX_CHARS = 254;
export const CONTACT_PHONE_MAX_CHARS = 40;

export type ContactInput = {
  firstName: string;
  lastName: string;
  role: string;
  email: string;
  phone?: string | null;
};

export type ContactField = "firstName" | "lastName" | "role" | "email" | "phone";

export type CleanContact = {
  firstName: string;
  lastName: string;
  role: string;
  email: string;
  phone: string | undefined;
};

/** Something, an @, something, a dot, something; no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/**
 * The trimmed contact and the message for each field that fails, in the
 * order the dialog shows them. No errors means the contact can be saved.
 */
export function checkContact(input: ContactInput): {
  contact: CleanContact;
  errors: Partial<Record<ContactField, string>>;
} {
  const contact: CleanContact = {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    role: input.role.trim(),
    email: input.email.trim(),
    phone: input.phone?.trim() || undefined,
  };
  const errors: Partial<Record<ContactField, string>> = {};
  if (!contact.firstName) errors.firstName = "Enter their first name";
  else if (contact.firstName.length > CONTACT_NAME_MAX_CHARS)
    errors.firstName = `Use ${CONTACT_NAME_MAX_CHARS} characters or fewer`;
  if (!contact.lastName) errors.lastName = "Enter their last name";
  else if (contact.lastName.length > CONTACT_NAME_MAX_CHARS)
    errors.lastName = `Use ${CONTACT_NAME_MAX_CHARS} characters or fewer`;
  if (!contact.role) errors.role = "Enter their role";
  else if (contact.role.length > CONTACT_ROLE_MAX_CHARS)
    errors.role = `Use ${CONTACT_ROLE_MAX_CHARS} characters or fewer`;
  if (!contact.email) errors.email = "Enter their email";
  else if (contact.email.length > CONTACT_EMAIL_MAX_CHARS || !looksLikeEmail(contact.email))
    errors.email = "Enter an email like name@example.com";
  if (contact.phone && contact.phone.length > CONTACT_PHONE_MAX_CHARS)
    errors.phone = `Use ${CONTACT_PHONE_MAX_CHARS} characters or fewer`;
  return { contact, errors };
}
