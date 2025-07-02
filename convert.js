// convert.js - FINAL VERSION (IDEMPOTENT BUILD)
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const puppeteer = require('puppeteer')

// --- CONFIGURATION ---
const CONFIG_PATH = './config.json'
const LUA_FILTER_PATH = './remove-toc.lua'
const CSS_PATH = './styles.css'
const JS_LOADER_PATH = './katex-loader.js'
const MASTER_TEMPLATE_PATH = './template.html'
const TUL_TEMPLATE_PATH = './template-tul.html' // NEW: Path to the TUL template
const MANIFEST_NAME = 'manifest.json'

// --- HELPER FUNCTION FOR DATE FORMATTING ---
function getFormattedDate(date) {
  if (!date) return 'N/A'
  const d = new Date(date)
  return `${d.toLocaleDateString('cs-CZ')} v ${d.toLocaleTimeString('cs-CZ')}`
}

// --- PDF GENERATION FUNCTION ---
async function generatePdfFromHtml(htmlPath, pdfPath, updateDate, generationDate) {
  console.log(`   -> Generating PDF for "${path.basename(htmlPath)}"...`)
  let browser
  try {
    browser = await puppeteer.launch({ headless: 'new' })
    const page = await browser.newPage()
    await page.goto('file://' + path.resolve(htmlPath), { waitUntil: 'networkidle0' })

    await page.evaluate(
      (updateDate, generationDate) => {
        const titleUpdate = document.querySelector('#pdf-title-page .update-date')
        const titleGen = document.querySelector('#pdf-title-page .generation-date')
        const lastUpdate = document.querySelector('#pdf-last-page .update-date')
        const lastGen = document.querySelector('#pdf-last-page .generation-date')

        if (titleUpdate) titleUpdate.textContent = updateDate
        if (titleGen) titleGen.textContent = generationDate
        if (lastUpdate) lastUpdate.textContent = updateDate
        if (lastGen) lastGen.textContent = generationDate
      },
      updateDate,
      generationDate
    )

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '2cm', right: '2cm', bottom: '2cm', left: '2cm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div></div>',
    })
    console.log(`   -> ✓ PDF successfully created at "${path.basename(pdfPath)}"`)
  } catch (e) {
    console.error(`   -> ❌ PDF generation failed: ${e.message}`)
  } finally {
    if (browser) await browser.close()
  }
}

// --- MAIN EXECUTION LOGIC ---
async function main() {
  console.log('🚀 Starting Study Hub build process...')

  let anyFileUpdated = false

  const generationDate = new Date()
  const formattedGenerationDate = getFormattedDate(generationDate)
  let latestUpdateTime = 0

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
  const { sources, outputDir } = config

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  fs.copyFileSync(CSS_PATH, path.join(outputDir, 'styles.css'))
  fs.copyFileSync(JS_LOADER_PATH, path.join(outputDir, 'katex-loader.js'))
  fs.copyFileSync('./favicon.svg', path.join(outputDir, 'favicon.svg'))

  // NEW: Copy local fonts directory if it exists
  const fontsDir = './fonts'
  if (fs.existsSync(fontsDir)) {
    fs.cpSync(fontsDir, path.join(outputDir, 'fonts'), { recursive: true })
  }

  console.log(`🎨 Copied site-wide assets to ${outputDir}`)

  const manifestPath = path.join(outputDir, MANIFEST_NAME)
  let manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) : {}
  const siteStructure = []

  for (const source of sources) {
    const directoryFiles = { directoryName: source.name, files: [], template: source.template } // Pass template info
    const sourceSlug = slugify(source.name)

    if (!source.update) {
      console.log(`\n⏭️  Skipping directory (reading from manifest): "${source.name}"`)
      for (const manifestKey in manifest) {
        if (manifest[manifestKey].sourceSlug === sourceSlug) {
          const entry = manifest[manifestKey]
          const outputPath = path.join(outputDir, entry.htmlName || entry.sourcePdfName)
          const stats = fs.existsSync(outputPath) ? fs.statSync(outputPath) : { mtimeMs: 0 }
          directoryFiles.files.push({ ...entry, modifiedTime: stats.mtimeMs })
        }
      }
      if (directoryFiles.files.length > 0) siteStructure.push(directoryFiles)
      continue
    }

    console.log(`\n🔄 Processing directory for updates: "${source.name}"`)
    if (!fs.existsSync(source.path)) continue

    const sourceFiles = fs.readdirSync(source.path)
    const fileGroups = new Map()

    for (const file of sourceFiles) {
      const ext = path.extname(file).toLowerCase()
      if (ext !== '.docx' && ext !== '.pdf') continue

      const baseName = path.basename(file, ext)
      if (!fileGroups.has(baseName)) {
        fileGroups.set(baseName, {})
      }
      if (ext === '.docx') fileGroups.get(baseName).docx = file
      if (ext === '.pdf') fileGroups.get(baseName).pdf = file
    }

    if (fileGroups.size === 0) continue

    for (const [baseName, files] of fileGroups.entries()) {
      const slugBase = slugify(baseName)
      const manifestKey = `${sourceSlug}-${slugBase}`

      let fileType = ''
      if (files.docx && files.pdf) fileType = 'docx_and_pdf'
      else if (files.docx) fileType = 'docx'
      else if (files.pdf) fileType = 'pdf'
      else continue

      console.log(`\n-> Processing "${baseName}" (Type: ${fileType})`)

      const originalDocxPath = files.docx ? path.join(source.path, files.docx) : null
      const originalPdfPath = files.pdf ? path.join(source.path, files.pdf) : null
      const docxStats = originalDocxPath ? fs.statSync(originalDocxPath) : null
      const pdfStats = originalPdfPath ? fs.statSync(originalPdfPath) : null

      const updateTime = Math.max(docxStats?.mtimeMs || 0, pdfStats?.mtimeMs || 0)
      const updateDate = new Date(updateTime)
      const formattedUpdateDate = getFormattedDate(updateDate)
      if (updateTime > latestUpdateTime) latestUpdateTime = updateTime

      const manifestEntry = {
        key: manifestKey,
        type: fileType,
        originalName: baseName,
        sourceSlug: sourceSlug,
        modifiedTime: updateTime,
        showUpdatesAfter: source.showUpdatesAfter,
        template: source.template, // Store template info in manifest
      }

      if (fileType.startsWith('docx')) {
        const safeHtmlName = `${sourceSlug}-${slugBase}.html`
        const safeDocxName = `${sourceSlug}-${slugBase}.docx`
        const safeGeneratedPdfName = `${sourceSlug}-${slugBase}.pdf`
        const safeSourcePdfName = files.pdf ? `${sourceSlug}-${slugBase}.source.pdf` : null

        const outputHtmlPath = path.join(outputDir, safeHtmlName)
        const outputDocxPath = path.join(outputDir, safeDocxName)
        const outputGeneratedPdfPath = path.join(outputDir, safeGeneratedPdfName)
        const outputSourcePdfPath = safeSourcePdfName ? path.join(outputDir, safeSourcePdfName) : null

        Object.assign(manifestEntry, {
          htmlName: safeHtmlName,
          docxName: safeDocxName,
          generatedPdfName: safeGeneratedPdfName,
          sourcePdfName: safeSourcePdfName,
        })

        const htmlExists = fs.existsSync(outputHtmlPath)
        const htmlMtime = htmlExists ? fs.statSync(outputHtmlPath).mtimeMs : 0
        let shouldConvertHtml = !htmlExists || docxStats.mtimeMs > htmlMtime || (pdfStats && pdfStats.mtimeMs > htmlMtime)

        const mediaDirName = `${sourceSlug}-${slugBase}-media`
        const finalMediaDir = path.join(outputDir, mediaDirName)

        if (shouldConvertHtml) {
          anyFileUpdated = true
          if (fs.existsSync(finalMediaDir)) {
            console.log(`   -> Removing old media directory: "${mediaDirName}"`)
            fs.rmSync(finalMediaDir, { recursive: true, force: true })
          }
          const originalCwd = process.cwd()
          try {
            console.log(`   -> Converting "${baseName}"...`)
            process.chdir(outputDir)

            // --- TEMPLATE SELECTION LOGIC ---
            const templateName = source.template || 'default'
            const activeTemplatePath = templateName === 'tul' ? TUL_TEMPLATE_PATH : MASTER_TEMPLATE_PATH
            console.log(`   -> Using template: "${templateName}" (${path.basename(activeTemplatePath)})`)

            const pandocSourcePath = path.relative(process.cwd(), path.resolve(originalCwd, originalDocxPath))
            const pandocTempHtmlPath = path.basename(outputHtmlPath) + '.temp'
            const pandocLuaFilterPath = path.relative(process.cwd(), path.resolve(originalCwd, LUA_FILTER_PATH))
            const pandocTemplatePath = path.relative(process.cwd(), path.resolve(originalCwd, activeTemplatePath)) // Use the selected template

            const pandocCommand = [
              'pandoc',
              `"${pandocSourcePath}"`,
              '-t',
              'html',
              '-s',
              '-o',
              `"${pandocTempHtmlPath}"`,
              '--katex',
              '--toc',
              `--lua-filter="${pandocLuaFilterPath}"`,
              `--template="${pandocTemplatePath}"`,
              `--metadata=group-name:"${source.name}"`,
              `--metadata=docx_path:"${safeDocxName}"`,
              `--metadata=pdf_path:"${safeGeneratedPdfName}"`,
              `--metadata=generation_date:"${formattedGenerationDate}"`,
              `--metadata=update_date:"${formattedUpdateDate}"`,
              `--extract-media="${mediaDirName}"`,
              safeSourcePdfName ? `--metadata=source_pdf_path:"${safeSourcePdfName}"` : '',
            ]
              .filter(Boolean)
              .join(' ')

            execSync(pandocCommand, { stdio: 'pipe', encoding: 'utf-8' })
            process.chdir(originalCwd)

            fs.renameSync(path.join(outputDir, pandocTempHtmlPath), outputHtmlPath)
            fs.copyFileSync(originalDocxPath, outputDocxPath)
            if (safeSourcePdfName) fs.copyFileSync(originalPdfPath, outputSourcePdfPath)
            console.log(`   -> ✨ Successfully created "${safeHtmlName}" and supporting files.`)
          } catch (error) {
            process.chdir(originalCwd)
            console.error(`\n❌ FATAL ERROR during conversion of "${files.docx}". Aborting.`, error.stderr || error.message)
            if (fs.existsSync(path.join(outputDir, outputHtmlPath + '.temp'))) fs.unlinkSync(path.join(outputDir, outputHtmlPath + '.temp'))
            if (fs.existsSync(finalMediaDir)) fs.rmSync(finalMediaDir, { recursive: true, force: true })
            process.exit(1)
          }
        } else {
          console.log(`   -> Skipping HTML build for "${baseName}" (no changes).`)
        }

        let shouldGeneratePdf =
          !fs.existsSync(outputGeneratedPdfPath) || fs.statSync(outputHtmlPath).mtimeMs > fs.statSync(outputGeneratedPdfPath).mtimeMs
        if (shouldGeneratePdf) {
          anyFileUpdated = true
          await generatePdfFromHtml(outputHtmlPath, outputGeneratedPdfPath, formattedUpdateDate, formattedGenerationDate)
        } else {
          console.log(`   -> Skipping Generated PDF build for "${baseName}" (no changes).`)
        }
      } else if (fileType === 'pdf') {
        const safeSourcePdfName = `${sourceSlug}-${slugBase}.pdf`
        const outputPdfPath = path.join(outputDir, safeSourcePdfName)
        Object.assign(manifestEntry, { sourcePdfName: safeSourcePdfName })

        let shouldCopyPdf = !fs.existsSync(outputPdfPath) || pdfStats.mtimeMs > fs.statSync(outputPdfPath).mtimeMs
        if (shouldCopyPdf) {
          anyFileUpdated = true
          console.log(`   -> Copying source PDF "${files.pdf}"...`)
          fs.copyFileSync(originalPdfPath, outputPdfPath)
        } else {
          console.log(`   -> Skipping PDF copy for "${baseName}" (no changes).`)
        }
      }

      manifest[manifestKey] = manifestEntry
      directoryFiles.files.push(manifestEntry)
    }
    if (directoryFiles.files.length > 0) siteStructure.push(directoryFiles)
  }

  if (anyFileUpdated) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    console.log('\n💾 Manifest saved.')
    console.log('\n📄 Generating index.html...')
    const indexHtmlContent = generateIndexHtml(siteStructure, formattedGenerationDate, getFormattedDate(latestUpdateTime))
    fs.writeFileSync(path.join(outputDir, 'index.html'), indexHtmlContent)
    console.log('\n✅ All done! Your Study Hub is complete.')
  } else {
    console.log('\n- No file updates detected. Skipping manifest and index.html generation.')
    console.log('\n✅ All done! Your Study Hub is up-to-date.')
  }
}

// --- HELPER FUNCTIONS (generateIndexHtml and slugify are unchanged) ---
function slugify(text) {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w.-]+/g, '')
    .replace(/--+/g, '-')
}

function generateIndexHtml(structure, generationDate, latestUpdateDate) {
  structure.sort((a, b) => a.directoryName.localeCompare(b.directoryName))
  const now = Date.now()
  const recentThreshold = 90 * 24 * 60 * 60 * 1000
  const activeThreshold = 210 * 24 * 60 * 60 * 1000

  // --- NEW: SVG Icons for cards (cleaner versions) ---
  const pageIconSvg = `<svg class="card-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`
  const pdfIconSvg = `<svg class="card-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M10.29 13.71a2.43 2.43 0 0 1-2.43-2.43 2.43 2.43 0 0 1 2.43-2.43H12V13h-.29a2.43 2.43 0 0 1-1.42.42zM15 9h-1v4h1v-2a1 1 0 0 0-1-1h0a1 1 0 0 0-1 1v2h-1v-4h1v1h1a2 2 0 0 1 2 2v1h-1z"></path></svg>`

  const allFiles = []
  structure.forEach(dir => {
    dir.files.forEach(file => {
      allFiles.push({ ...file, directoryName: dir.directoryName, template: dir.template })
    })
  })

  const activeFiles = allFiles
    .filter(file => {
      const isActive = now - file.modifiedTime < activeThreshold
      const isAfterCutoff = !file.showUpdatesAfter || file.modifiedTime > new Date(file.showUpdatesAfter).getTime()
      return isActive && isAfterCutoff
    })
    .sort((a, b) => b.modifiedTime - a.modifiedTime)

  const createCardHtml = (file, isRecentlyUpdated = false) => {
    const isPdf = file.type === 'pdf'
    const link = isPdf ? `./${file.sourcePdfName}` : `./${file.htmlName}`
    const target = isPdf ? `target="_blank" rel="noopener noreferrer"` : ''
    const icon = isPdf ? pdfIconSvg : pageIconSvg
    const newBadge = now - file.modifiedTime < recentThreshold ? `<span class="badge card-badge">NOVÉ</span>` : ''
    const pdfBadge = isPdf ? `<span class="badge pdf-badge card-badge">PDF</span>` : ''
    const subtitleClass = isRecentlyUpdated ? 'card-subtitle-active' : 'card-subtitle'
    const templateClass = file.template === 'tul' ? 'template-tul-card' : ''

    return `
      <a href="${link}" ${target} class="file-card ${templateClass}" data-file-name="${file.originalName.toLowerCase()}" data-directory-name="${file.directoryName.toLowerCase()}">
        ${icon}
        <div class="card-content">
          <h3 class="card-title">${file.originalName}</h3>
          <p class="${subtitleClass}">${file.directoryName}</p>
        </div>
        ${newBadge || pdfBadge}
      </a>
    `
  }

  let activeFilesHtml = ''
  if (activeFiles.length > 0) {
    activeFilesHtml += `<div class="active-files-group directory-group" data-directory-name="nedávno aktualizované">
      <h2>Nedávno aktualizované</h2>
      <div class="card-grid">`
    activeFiles.forEach(file => {
      activeFilesHtml += createCardHtml(file, true)
    })
    activeFilesHtml += `</div></div>`
  }

  let fileListHtml = ''
  for (const dir of structure) {
    dir.files.sort((a, b) => a.originalName.localeCompare(b.originalName))
    fileListHtml += `<div class="directory-group" data-directory-name="${dir.directoryName.toLowerCase()}">
      <h2>${dir.directoryName}</h2>`

    const needsButton = dir.files.length > 2
    if (needsButton) {
      fileListHtml += `<div class="card-grid-container">`
    }

    fileListHtml += `<div class="card-grid ${needsButton ? 'collapsed' : ''}">`
    for (const file of dir.files) {
      // THIS IS THE FIX: Create an object with the full context before passing it to the function.
      const fileWithContext = { ...file, directoryName: dir.directoryName, template: dir.template }
      fileListHtml += createCardHtml(fileWithContext, false)
    }
    fileListHtml += `</div>` // close .card-grid

    if (needsButton) {
      fileListHtml += `<button class="toggle-visibility-button">Zobrazit všech ${dir.files.length}</button>`
      fileListHtml += `</div>` // close .card-grid-container
    }

    fileListHtml += `</div>` // close .directory-group
  }

  return `
<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Univerzitní studium - materiály a přednášky</title>
    <link rel="stylesheet" href="styles.css">
    <link rel="icon" href="favicon.svg" type="image/svg+xml">
</head>
<body>
    <div class="container index-container">
        <h1>Univerzitní studium</h1>
        <p class="index-subtitle">Osobní materiály a poznámky z přednášek</p>
        <div class="page-info">
            <span>Poslední sestavení: <strong>${generationDate}</strong></span>
            <span>Poslední aktualizace: <strong>${latestUpdateDate}</strong></span>
        </div>
        <div class="search-container">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="search-icon" fill="currentColor"><path d="M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-5.03-1.62a6 6 0 1 0 8.5-8.5 6 6 0 0 0-8.5 8.5zM21 22.41l-6.36-6.36 1.41-1.41L22.41 21 21 22.41z"/></svg>
          <input type="text" id="searchInput" placeholder="Hledat v poznámkách a předmětech...">
        </div>
        
        ${activeFilesHtml}
        
        <div id="file-list">${fileListHtml}</div>
    </div>
    <footer class="main-footer-license">
        <p>
            Veškeré materiály na této stránce jsou osobními poznámkami autora, vytvořenými na základě univerzitních přednášek.
            Jsou poskytovány bez záruky a slouží výhradně ke studijním účelům.
        </p>
        <p>
            Obsah je licencován pod <a href="http://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener noreferrer">Creative Commons Uveďte původ-Neužívejte komerčně-Zachovejte licenci 4.0 Mezinárodní</a>.
        </p>
    </footer>
    <script>
      // Search functionality
      const searchInput = document.getElementById('searchInput');
      searchInput.addEventListener('input', (e) => {
          const searchTerm = e.target.value.toLowerCase().trim();
          
          document.querySelectorAll('.directory-group').forEach(group => {
              const groupName = group.dataset.directoryName.toLowerCase();
              let hasVisibleCard = false;

              group.querySelectorAll('.file-card').forEach(card => {
                  const fileName = card.dataset.fileName.toLowerCase();
                  const dirName = card.dataset.directoryName.toLowerCase();
                  const searchCorpus = fileName + ' ' + dirName;
                  
                  const isVisible = searchCorpus.includes(searchTerm);
                  card.style.display = isVisible ? 'flex' : 'none';
                  if (isVisible) hasVisibleCard = true;
              });

              // A group is visible if its name matches or it has at least one visible card.
              const isGroupVisible = groupName.includes(searchTerm) || hasVisibleCard;
              group.style.display = isGroupVisible ? 'block' : 'none';
          });
      });

      // NEW: Expand/Collapse functionality
      document.querySelectorAll('.toggle-visibility-button').forEach(button => {
        button.addEventListener('click', () => {
          const container = button.closest('.card-grid-container');
          if (!container) return;

          const grid = container.querySelector('.card-grid');
          const isCollapsed = grid.classList.toggle('collapsed');

          if (isCollapsed) {
            button.textContent = \`Zobrazit všech \${grid.children.length}\`;
          } else {
            button.textContent = 'Skrýt';
          }
        });
      });
    </script>
</body>
</html>`
}

main().catch(error => {
  console.error('❌ An unexpected error occurred:', error)
})
