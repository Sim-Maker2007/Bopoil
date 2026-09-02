import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CRM_LOCALE_STORAGE_KEY, translateCrmText } from "../app/crm-language.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("translates the admin CRM navigation and operational copy into Canadian French", () => {
  assert.equal(translateCrmText("Today"), "Aujourd’hui");
  assert.equal(translateCrmText("Clients & pets"), "Clients et animaux");
  assert.equal(translateCrmText("New appointment"), "Nouveau rendez-vous");
  assert.equal(translateCrmText("Good morning, Amara."), "Bonjour, Amara.");
  assert.equal(translateCrmText("12 appointments"), "12 rendez-vous");
});

test("admin and employee surfaces share one persistent language preference", async () => {
  const [page, loginPage, loginForm, onboarding, workspace, employee, setup, boundary] = await Promise.all([
    source("../app/salon/page.tsx"),
    source("../app/salon/login/page.tsx"),
    source("../app/salon/login/salon-login-form.tsx"),
    source("../app/salon/salon-onboarding.tsx"),
    source("../app/salon/salon-workspace.tsx"),
    source("../app/employee/employee-portal.tsx"),
    source("../app/employee/setup/[token]/setup.tsx"),
    source("../app/crm-language-boundary.tsx"),
  ]);

  assert.equal(CRM_LOCALE_STORAGE_KEY, "bopoil-crm-locale");
  assert.match(page, /CrmLanguageBoundary/);
  assert.match(loginPage, /CrmLanguageBoundary/);
  assert.match(loginForm, /CrmLanguageSwitch/);
  assert.match(onboarding, /CrmLanguageSwitch/);
  assert.match(workspace, /CrmLanguageSwitch/);
  assert.match(employee, /CRM_LOCALE_STORAGE_KEY/);
  assert.match(setup, /CRM_LOCALE_STORAGE_KEY/);
  assert.match(boundary, /MutationObserver/);
  assert.match(boundary, /navigator\.language/);
  assert.match(boundary, /aria-pressed=\{locale === "fr"\}/);
});
