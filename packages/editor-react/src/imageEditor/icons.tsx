/**
 * Image-editor chrome icons. Thin wrappers around the shared {@link Icon}
 * component, which renders Font Awesome Free glyphs via the webfont CSS
 * imported in `styles/index.css`. Color and size flow from the parent's
 * `color` / `font-size` (e.g. `--squisq-image-editor-text`), matching the
 * toolbar icons so the whole editor shares one icon style.
 */

import { Icon, type IconProps } from '../Icon';

type Props = Omit<IconProps, 'icon'>;

export function EyeIcon(props: Props) {
  return <Icon icon="fa-solid fa-eye" {...props} />;
}

export function EyeOffIcon(props: Props) {
  return <Icon icon="fa-solid fa-eye-slash" {...props} />;
}

export function LockIcon(props: Props) {
  return <Icon icon="fa-solid fa-lock" {...props} />;
}

export function UnlockIcon(props: Props) {
  return <Icon icon="fa-solid fa-lock-open" {...props} />;
}

export function ChevronUpIcon(props: Props) {
  return <Icon icon="fa-solid fa-chevron-up" {...props} />;
}

export function ChevronDownIcon(props: Props) {
  return <Icon icon="fa-solid fa-chevron-down" {...props} />;
}

export function CloseIcon(props: Props) {
  return <Icon icon="fa-solid fa-xmark" {...props} />;
}

export function CursorIcon(props: Props) {
  return <Icon icon="fa-solid fa-arrow-pointer" {...props} />;
}

export function TextIcon(props: Props) {
  return <Icon icon="fa-solid fa-font" {...props} />;
}

export function ShapeIcon(props: Props) {
  return <Icon icon="fa-solid fa-shapes" {...props} />;
}

export function CropIcon(props: Props) {
  return <Icon icon="fa-solid fa-crop-simple" {...props} />;
}

export function PlusIcon(props: Props) {
  return <Icon icon="fa-solid fa-plus" {...props} />;
}

export function NoneIcon(props: Props) {
  // "No fill / transparent" affordance.
  return <Icon icon="fa-solid fa-ban" {...props} />;
}
