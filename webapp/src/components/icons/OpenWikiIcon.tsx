import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";

// Single-color vector of the mark OpenWiki shows in its visualizer (the openwiki package,
// by LangChain, MIT); inherits MUI's currentColor.
function OpenWikiIcon(props: SvgIconProps) {
  return (
    // The mark fills its 489 box and is denser than Material icons, so the view adds a
    // margin that draws it at about their size next to them.
    <SvgIcon viewBox="-94 -94 677 677" titleAccess="OpenWiki" {...props}>
      <path d="M153.197 324.988C181.918 296.266 198.063 257.269 198.063 216.654C198.063 176.039 181.904 137.042 153.197 108.32L44.866 0C16.159 28.7218 0 67.7192 0 108.334C0 148.949 16.159 187.946 44.866 216.668L153.183 324.988H153.197Z" />
      <path d="M379.871 335.012C351.164 306.304 312.153 290.145 271.554 290.145C230.954 290.145 191.944 306.304 163.223 335.012L271.554 443.346C300.261 472.054 339.271 488.213 379.885 488.213C420.498 488.213 459.495 472.054 488.215 443.346L379.885 335.012H379.871Z" />
      <path d="M45.13 443.096C73.8509 471.804 112.847 487.963 153.461 487.963V334.762H0.25C0.263942 375.377 16.409 414.374 45.13 443.096Z" />
      <path d="M421.695 174.84C392.974 146.132 353.978 129.959 313.35 129.973C272.737 129.973 233.74 146.132 205.02 174.854L313.35 283.188L421.695 174.84Z" />
    </SvgIcon>
  );
}

export default OpenWikiIcon;
