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
      margin: { top: '25px', right: '25px', bottom: '25px', left: '25px' },
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
    const directoryFiles = { directoryName: source.name, files: [] }
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
// ... (the rest of the file is identical to your original)
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

  let allFiles = []
  structure.forEach(dir => {
    dir.files.forEach(file => {
      allFiles.push({ ...file, directoryName: dir.directoryName })
    })
  })

  const activeFiles = allFiles
    .filter(file => {
      const isActive = now - file.modifiedTime < activeThreshold
      const isAfterCutoff = !file.showUpdatesAfter || file.modifiedTime > new Date(file.showUpdatesAfter).getTime()
      return isActive && isAfterCutoff
    })
    .sort((a, b) => b.modifiedTime - a.modifiedTime)

  let activeFilesHtml = ''
  if (activeFiles.length > 0) {
    activeFilesHtml += `<div class="active-files-group" data-directory-name="nedávno aktualizované"><h2>Nedávno aktualizované</h2><ul>`
    activeFiles.forEach(file => {
      const link =
        file.type === 'pdf'
          ? `<a href="./${file.sourcePdfName}" target="_blank" rel="noopener noreferrer">${file.originalName} <span class="badge pdf-badge">PDF</span></a>`
          : `<a href="./${file.htmlName}">${file.originalName}</a>`

      activeFilesHtml += `
            <li data-file-name="${file.originalName.toLowerCase()}" data-directory-name="${file.directoryName.toLowerCase()}">
                ${link}
                <span class="file-group-name">(${file.directoryName})</span>
            </li>`
    })
    activeFilesHtml += `</ul></div>`
  }

  let fileListHtml = ''
  for (const dir of structure) {
    dir.files.sort((a, b) => a.originalName.localeCompare(b.originalName))
    fileListHtml += `<div class="directory-group" data-directory-name="${dir.directoryName.toLowerCase()}"><h2>${
      dir.directoryName
    }</h2><ul>`
    for (const file of dir.files) {
      const isRecent = now - file.modifiedTime < recentThreshold
      const newBadge = isRecent ? ' <span class="badge">NOVÉ</span>' : ''
      const link =
        file.type === 'pdf'
          ? `<a href="./${file.sourcePdfName}" target="_blank" rel="noopener noreferrer">${file.originalName} <span class="badge pdf-badge">PDF</span></a>`
          : `<a href="./${file.htmlName}">${file.originalName}</a>`

      fileListHtml += `<li data-file-name="${file.originalName.toLowerCase()}">${link}${newBadge}</li>`
    }
    fileListHtml += `</ul></div>`
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
    <div class="container">
        <h1>Univerzitní studium - materiály a přednášky</h1>
        <div class="page-info">
            <span>Poslední sestavení webu: <strong>${generationDate}</strong></span>
            <span>Poslední aktualizace poznámek: <strong>${latestUpdateDate}</strong></span>
        </div>
        <input type="text" id="searchInput" placeholder="Hledat v poznámkách...">
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
            To znamená, že materiály můžete volně sdílet a upravovat pro nekomerční účely, pokud uvedete původního autora a zachováte stejnou licenci.
        </p>
    </footer>
    <script>
        const searchInput = document.getElementById('searchInput');
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            document.querySelectorAll('.directory-group, .active-files-group').forEach(group => {
                const groupName = group.dataset.directoryName || '';
                const files = group.querySelectorAll('li');
                let hasVisibleFile = false;
                
                if (group.classList.contains('active-files-group')) {
                    files.forEach(file => {
                        const fileName = file.dataset.fileName;
                        const dirName = file.dataset.directoryName;
                        const isVisible = fileName.includes(searchTerm) || dirName.includes(searchTerm);
                        file.style.display = isVisible ? '' : 'none';
                        if (isVisible) hasVisibleFile = true;
                    });
                } else {
                    files.forEach(file => {
                        const fileName = file.dataset.fileName;
                        const isVisible = fileName.includes(searchTerm) || groupName.includes(searchTerm);
                        file.style.display = isVisible ? '' : 'none';
                        if (isVisible) hasVisibleFile = true;
                    });
                }

                const isGroupVisible = groupName.includes(searchTerm) || hasVisibleFile;
                group.style.display = isGroupVisible ? '' : 'none';
            });
        });
    </script>
</body>
</html>`
}

main().catch(error => {
  console.error('❌ An unexpected error occurred:', error)
})
