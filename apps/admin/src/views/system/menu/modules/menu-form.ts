import type { SystemMenuApi } from '#/api/system/menu';

export type MenuSubmitValues = Omit<
  SystemMenuApi.SystemMenu,
  'children' | 'id' | 'version'
>;
export type MenuFormValues = MenuSubmitValues & { linkSrc?: string };

export function encodeMenuFormValues(
  values: Readonly<MenuFormValues>,
  originalMeta?: SystemMenuApi.SystemMenu['meta'],
  editableMetaFields: readonly string[] = [],
): MenuSubmitValues {
  const { linkSrc, ...formValues } = values;
  // setSubmitValues filters fields absent from the schema; retain those extensions.
  const retainedMeta = { ...originalMeta };
  // Omitted editable fields mean clear, so do not restore their previous values.
  for (const key of editableMetaFields)
    Reflect.deleteProperty(retainedMeta, key);
  const meta = { ...retainedMeta, ...values.meta };
  Reflect.deleteProperty(meta, 'link');
  Reflect.deleteProperty(meta, 'iframeSrc');
  if (values.type === 'link') meta.link = linkSrc;
  if (values.type === 'embedded') meta.iframeSrc = linkSrc;
  // Explicit null clears the previous component when changing menu types.
  let component: MenuSubmitValues['component'] = null;
  if (values.type === 'embedded') component = 'IFrameView';
  else if (values.type === 'menu') component = values.component;
  else if (values.type === 'catalog' && values.component === 'BasicLayout')
    component = 'BasicLayout';
  return {
    ...formValues,
    component,
    path: values.type === 'button' ? '' : values.path,
    meta,
  };
}

export function decodeMenuFormValues(
  values: Readonly<MenuSubmitValues>,
): MenuFormValues {
  let linkSrc: string | undefined;
  if (values.type === 'link') linkSrc = values.meta?.link;
  else if (values.type === 'embedded') linkSrc = values.meta?.iframeSrc;
  return { ...values, linkSrc };
}
