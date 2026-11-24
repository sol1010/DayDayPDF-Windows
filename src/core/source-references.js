export function collectPageSourceRefs(pageList, into, sourceExists = () => true) {
  const out = into || new Set();
  for (const page of pageList) {
    if (page.src) out.add(page.src);
    for (const object of (page.texts || [])) {
      if (object.clipSrc && sourceExists(object.clipSrc)) out.add(object.clipSrc);
    }
  }
  return out;
}
