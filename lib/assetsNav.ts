/** 资产列表页路径：优先回到进入编辑/新建前的分类 tab */
export function assetsListHref(
  returnCat?: string | null,
  savedCategoryCode?: string | null
): string {
  if (returnCat === "all") return "/assets";
  if (returnCat) return `/assets?cat=${returnCat}`;
  if (savedCategoryCode) return `/assets?cat=${savedCategoryCode}`;
  return "/assets";
}

export function editAssetHref(id: number, returnCat?: string): string {
  if (!returnCat || returnCat === "all") return `/assets/${id}`;
  return `/assets/${id}?cat=${returnCat}`;
}

export function newAssetHref(returnCat?: string): string {
  if (!returnCat || returnCat === "all") return "/assets/new";
  return `/assets/new?cat=${returnCat}`;
}
