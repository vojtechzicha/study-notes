-- clean-document.lua
-- A filter to clean up common artifacts from DOCX conversion.

-- Rule 1: Remove all HorizontalRule elements from the document.
-- These are often generated from page breaks or section breaks in Word.
function HorizontalRule(hr)
  -- Returning an empty list effectively deletes the element.
  return {}
end

-- Rule 2: Remove the static TOC from the document.
-- This looks for paragraphs that contain only a single Link element.
function Para(p)
  -- Check if the paragraph's content has exactly one element.
  if #p.content == 1 then
    -- Check if that single element is a Link.
    if p.content[1].t == "Link" then
      -- If true, it's an unwanted TOC entry, so delete it.
      return {}
    end
  end

  -- If the paragraph is not a TOC entry, keep it by returning it unchanged.
  return p
end