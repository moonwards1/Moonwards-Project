<!--
LORE ENTRIES — the text behind every info note on the site, and the Lore page.
(Anything between these comment markers is ignored by the site.)

CHAPTERS
  # Chapter title
  Groups the entries below it on the Lore page. Optional; reorder freely.

ENTRIES
  ## Title as shown {#entry-id tier=2}
  Text of the note, in Markdown.

  - entry-id: lower case with hyphens. The site's marks point at this id, so
    changing it means the marks must change too (ask Claude). The title can
    change freely.
  - tier=1  tooltip: short, plain text — meaning or how-to
    tier=2  orange-underlined word, opens a dialog
    tier=3  orange ⓘ, opens a dialog — central information
  - An entry with no text yet is a stub: its mark works, and shows
    "Note not written yet". Add ?lore=pending to any page's address to
    outline the marks still waiting for text; the Lore page has a
    Pending filter.

WRITING THE TEXT
  Blank line = new paragraph.      **bold**   *italic*
  ### Subheading                   - bullet list    1. numbered list
  [text](#other-entry-id)          opens that entry in place, Nutshell-style
                                   (nests two deep; deeper opens the Lore page)
  [text](https://…)                an outside link, opens in a new tab
  ![Caption](images/picture.png)   an image or video (.mp4/.webm) on its own
                                   line; paths are relative to this folder
  $v = \sqrt{GM/r}$                inline maths (KaTeX)
  $$                               display maths on its own lines
  \Delta v = v_e \ln(m_0/m_f)
  $$
-->

