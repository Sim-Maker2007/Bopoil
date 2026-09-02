"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { CRM_LOCALE_STORAGE_KEY, CrmLocale, translateCrmText } from "./crm-language";

type LanguageContextValue = {
  locale: CrmLocale;
  chooseLocale: (locale: CrmLocale) => void;
};

const LanguageContext = createContext<LanguageContextValue>({
  locale: "en",
  chooseLocale: () => undefined,
});

type TextSnapshot = { english: string; rendered: string };
type AttributeSnapshot = { english: string; rendered: string };
const translatedAttributes = ["aria-label", "aria-description", "placeholder", "title"] as const;

export function CrmLanguageBoundary({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<CrmLocale>("en");
  const rootRef = useRef<HTMLDivElement>(null);
  const textSnapshots = useRef(new WeakMap<Text, TextSnapshot>());
  const attributeSnapshots = useRef(new WeakMap<Element, Map<string, AttributeSnapshot>>());

  useEffect(() => {
    const saved = window.localStorage.getItem(CRM_LOCALE_STORAGE_KEY);
    const preferred = saved === "en" || saved === "fr"
      ? saved
      : navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
    const timer = window.setTimeout(() => setLocale(preferred), 0);

    function syncAcrossTabs(event: StorageEvent) {
      if (event.key === CRM_LOCALE_STORAGE_KEY && (event.newValue === "en" || event.newValue === "fr")) setLocale(event.newValue);
    }
    window.addEventListener("storage", syncAcrossTabs);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("storage", syncAcrossTabs);
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const applyText = (node: Text) => {
      if (node.parentElement?.closest("[data-no-crm-translate]")) return;
      const current = node.nodeValue || "";
      const previous = textSnapshots.current.get(node);
      const english = previous && current === previous.rendered ? previous.english : current;
      const rendered = locale === "fr" ? translateCrmText(english) : english;
      textSnapshots.current.set(node, { english, rendered });
      if (current !== rendered) node.nodeValue = rendered;
    };

    const applyAttributes = (element: Element) => {
      const snapshots = attributeSnapshots.current.get(element) || new Map<string, AttributeSnapshot>();
      for (const attribute of translatedAttributes) {
        if (!element.hasAttribute(attribute)) continue;
        const current = element.getAttribute(attribute) || "";
        const previous = snapshots.get(attribute);
        const english = previous && current === previous.rendered ? previous.english : current;
        const rendered = locale === "fr" ? translateCrmText(english) : english;
        snapshots.set(attribute, { english, rendered });
        if (current !== rendered) element.setAttribute(attribute, rendered);
      }
      attributeSnapshots.current.set(element, snapshots);
    };

    const applyTree = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        applyText(node as Text);
        return;
      }
      if (!(node instanceof Element)) return;
      if (node.matches("[data-no-crm-translate], [data-no-crm-translate] *")) return;
      applyAttributes(node);
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        if (current.nodeType === Node.TEXT_NODE && !(current as Text).parentElement?.closest("[data-no-crm-translate]")) applyText(current as Text);
        else if (current instanceof Element && !current.closest("[data-no-crm-translate]")) applyAttributes(current);
        current = walker.nextNode();
      }
    };

    const observer = new MutationObserver((records) => {
      observer.disconnect();
      for (const record of records) {
        if (record.type === "characterData") applyTree(record.target);
        else if (record.type === "attributes") applyAttributes(record.target as Element);
        else record.addedNodes.forEach(applyTree);
      }
      observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...translatedAttributes] });
    });

    applyTree(root);
    observer.takeRecords();
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...translatedAttributes] });
    return () => observer.disconnect();
  }, [locale]);

  function chooseLocale(next: CrmLocale) {
    setLocale(next);
    window.localStorage.setItem(CRM_LOCALE_STORAGE_KEY, next);
  }

  return <LanguageContext.Provider value={{ locale, chooseLocale }}>
    <div ref={rootRef} className="crm-language-boundary" lang={locale === "fr" ? "fr-CA" : "en-CA"}>{children}</div>
  </LanguageContext.Provider>;
}

export function CrmLanguageSwitch() {
  const { locale, chooseLocale } = useContext(LanguageContext);
  return <div className="crm-language-toggle" aria-label="Language / Langue" data-no-crm-translate>
    <button type="button" aria-pressed={locale === "en"} onClick={() => chooseLocale("en")}>EN</button>
    <button type="button" aria-pressed={locale === "fr"} onClick={() => chooseLocale("fr")}>FR</button>
  </div>;
}
