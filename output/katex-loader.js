// katex-loader.js - FINAL POLISHED VERSION (with direct sidebar scroll fix)
// This script handles math rendering and synchronized scrolling for the TOC,
// and now intelligently centers the active link in the sidebar's viewport.

document.addEventListener('DOMContentLoaded', function () {
  // --- PART 1: KaTeX Math Rendering --- (No changes here)
  try {
    const mathElements = document.querySelectorAll('.math')
    if (typeof katex !== 'undefined' && mathElements.length > 0) {
      mathElements.forEach(element => {
        katex.render(element.textContent, element, {
          throwOnError: false,
          displayMode: element.classList.contains('display'),
        })
      })
    }
  } catch (e) {
    console.error('KaTeX rendering failed: ', e)
  }

  // --- PART 2: Synchronized Scrolling (Scroll-Spy) ---

  const mainContent = document.querySelector('.content')
  const sidebar = document.querySelector('.sidebar')
  if (!mainContent || !sidebar) return

  const tocLinks = sidebar.querySelectorAll('#TOC a')
  const headings = []

  tocLinks.forEach(link => {
    const anchorId = link.getAttribute('href')
    if (anchorId && anchorId.startsWith('#')) {
      const heading = document.getElementById(anchorId.substring(1))
      if (heading) {
        headings.push(heading)
      }
    }
  })

  if (headings.length === 0) return

  const onScroll = () => {
    const scrollPosition = window.scrollY
    const offset = 150 // An offset to trigger highlighting a bit early
    let activeHeadingId = null

    for (const heading of headings) {
      if (heading.offsetTop <= scrollPosition + offset) {
        activeHeadingId = heading.id
      } else {
        break
      }
    }

    tocLinks.forEach(link => {
      const isActive = activeHeadingId && link.getAttribute('href') === `#${activeHeadingId}`

      if (isActive && !link.classList.contains('active')) {
        // First, remove 'active' from any other link
        tocLinks.forEach(l => l.classList.remove('active'))

        // Then, add it to the correct one
        link.classList.add('active')

        // === THE NEW, ROBUST SCROLLING LOGIC ===
        // We now scroll the sidebar directly, instead of using scrollIntoView,
        // which was causing the disruptive scroll loop with the main window.

        // Calculate the position of the link relative to the top of the sidebar's content
        const linkOffsetTop = link.offsetTop

        // Calculate the desired scroll position to center the link in the sidebar's viewport
        const desiredScrollTop = linkOffsetTop - sidebar.clientHeight / 2 + link.clientHeight / 2

        // Programmatically scroll ONLY the sidebar. This will not trigger a window scroll event.
        sidebar.scrollTo({
          top: desiredScrollTop,
          behavior: 'smooth',
        })
      }
    })
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll() // Run on load to set initial state
})
