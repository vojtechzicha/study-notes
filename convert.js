// convert.js - FINAL VERSION WITH PDF GENERATION
// This script now builds the site and generates PDFs from the final HTML.

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const puppeteer = require('puppeteer') // Import the new library

// --- CONFIGURATION ---
const CONFIG_PATH = './config.json'
const LUA_FILTER_PATH = './remove-toc.lua'
const CSS_PATH = './styles.css'
const JS_LOADER_PATH = './katex-loader.js'
const MASTER_TEMPLATE_PATH = './template.html'
const MANIFEST_NAME = 'manifest.json'

// --- PDF GENERATION FUNCTION ---
async function generatePdfFromHtml(htmlPath, pdfPath) {
  console.log(`   -> Generating PDF for "${path.basename(htmlPath)}"...`)
  let browser
  try {
    browser = await puppeteer.launch({ headless: 'new' })
    const page = await browser.newPage()
    // Go to the local HTML file. 'networkidle0' waits for web fonts and KaTeX to load.
    await page.goto('file://' + path.resolve(htmlPath), { waitUntil: 'networkidle0' })
    // Generate the PDF
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true, // Important for including CSS background colors
      margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
    })
    console.log(`   -> ✓ PDF successfully created at "${path.basename(pdfPath)}"`)
  } catch (e) {
    console.error(`   -> ❌ PDF generation failed: ${e.message}`)
    // We don't abort the whole script, just skip this PDF.
  } finally {
    if (browser) await browser.close()
  }
}

// --- MAIN EXECUTION LOGIC ---
async function main() {
  console.log('🚀 Starting Study Hub build process (Final with PDFs)...')

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
  const { sources, outputDir } = config

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  fs.copyFileSync(CSS_PATH, path.join(outputDir, 'styles.css'))
  fs.copyFileSync(JS_LOADER_PATH, path.join(outputDir, 'katex-loader.js'))
  fs.copyFileSync('./favicon.svg', path.join(outputDir, 'favicon.svg'))
  console.log(`🎨 Copied site-wide assets to ${outputDir}`)

  const manifestPath = path.join(outputDir, MANIFEST_NAME)
  let manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) : {}
  const siteStructure = []

  for (const source of sources) {
    const directoryFiles = { directoryName: source.name, files: [] }
    const sourceSlug = slugify(source.name)

    if (!source.update) {
      console.log(`\n⏭️  Skipping directory (reading from manifest): "${source.name}"`)
      for (const htmlName in manifest) {
        if (htmlName.startsWith(sourceSlug + '-')) {
          const stats = fs.existsSync(path.join(outputDir, htmlName)) ? fs.statSync(path.join(outputDir, htmlName)) : { mtimeMs: 0 }
          directoryFiles.files.push({ ...manifest[htmlName], modifiedTime: stats.mtimeMs })
        }
      }
      if (directoryFiles.files.length > 0) siteStructure.push(directoryFiles)
      continue
    }

    console.log(`\n🔄 Processing directory for updates: "${source.name}"`)
    if (!fs.existsSync(source.path)) continue

    const docxFiles = fs.readdirSync(source.path).filter(file => file.toLowerCase().endsWith('.docx'))
    if (docxFiles.length === 0) continue

    for (const docxFile of docxFiles) {
      const originalDocxPath = path.join(source.path, docxFile)
      const baseName = path.basename(docxFile, '.docx')
      const slugBase = slugify(baseName)
      const safeHtmlName = `${sourceSlug}-${slugBase}.html`
      const safeDocxName = `${sourceSlug}-${slugBase}.docx`
      const safePdfName = `${sourceSlug}-${slugBase}.pdf`

      const outputHtmlPath = path.join(outputDir, safeHtmlName)
      const outputDocxPath = path.join(outputDir, safeDocxName)
      const outputPdfPath = path.join(outputDir, safePdfName)
      const tempHtmlPath = outputHtmlPath + '.temp'

      let shouldConvertHtml = !fs.existsSync(outputHtmlPath) || fs.statSync(originalDocxPath).mtimeMs > fs.statSync(outputHtmlPath).mtimeMs

      // NEW: Define the final media directory path for this specific document
      const mediaDirName = `${sourceSlug}-${slugBase}-media`
      const finalMediaDir = path.join(outputDir, mediaDirName)

      if (shouldConvertHtml) {
        // NEW: Before converting, remove the old media directory if it exists.
        // This handles cases where images are removed from the source DOCX.
        if (fs.existsSync(finalMediaDir)) {
          console.log(`   -> Removing old media directory: "${mediaDirName}"`)
          fs.rmSync(finalMediaDir, { recursive: true, force: true })
        }

        try {
          console.log(`   -> Converting "${baseName}"...`)
          const pandocCommand = [
            'pandoc',
            `"${path.resolve(originalDocxPath)}"`,
            '-t',
            'html',
            '-s',
            '-o',
            `"${tempHtmlPath}"`,
            '--katex',
            '--toc',
            `--lua-filter="${path.resolve(LUA_FILTER_PATH)}"`,
            `--template="${path.resolve(MASTER_TEMPLATE_PATH)}"`,
            `--metadata=group-name:"${source.name}"`,
            `--metadata=docx_path:"${safeDocxName}"`,
            `--metadata=pdf_path:"${safePdfName}"`,
            // UPDATED: Tell pandoc to extract media to the unique final directory.
            // Pandoc will create this directory and generate correct relative links.
            `--extract-media="${finalMediaDir}"`,
          ].join(' ')

          execSync(pandocCommand, { stdio: 'pipe', encoding: 'utf-8' })
          fs.renameSync(tempHtmlPath, outputHtmlPath)
          fs.copyFileSync(originalDocxPath, outputDocxPath)
          console.log(`   -> ✨ Successfully created "${safeHtmlName}" and extracted media.`)
        } catch (error) {
          console.error(`\n❌ FATAL ERROR during conversion of "${docxFile}". Aborting.`)
          console.error(error.stderr || error.message) // Log the actual Pandoc error

          // Cleanup temp HTML
          if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath)

          // NEW: Also clean up the partially created media directory on failure.
          if (fs.existsSync(finalMediaDir)) {
            console.error(`   -> Cleaning up failed media extraction at "${mediaDirName}"...`)
            fs.rmSync(finalMediaDir, { recursive: true, force: true })
          }

          process.exit(1)
        }
      } else {
        console.log(`   -> Skipping HTML build for "${baseName}" (no changes).`)
      }

      // Always generate PDF if the HTML is newer than the PDF
      let shouldGeneratePdf = !fs.existsSync(outputPdfPath) || fs.statSync(outputHtmlPath).mtimeMs > fs.statSync(outputPdfPath).mtimeMs
      if (shouldGeneratePdf) {
        await generatePdfFromHtml(outputHtmlPath, outputPdfPath)
      } else {
        console.log(`   -> Skipping PDF build for "${baseName}" (no changes).`)
      }

      manifest[safeHtmlName] = { originalName: baseName, htmlName: safeHtmlName }
      const finalStats = fs.statSync(outputHtmlPath)
      directoryFiles.files.push({ ...manifest[safeHtmlName], modifiedTime: finalStats.mtimeMs })
    }
    if (directoryFiles.files.length > 0) siteStructure.push(directoryFiles)
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log('\n💾 Manifest saved.')
  console.log('\n📄 Generating index.html...')
  const indexHtmlContent = generateIndexHtml(siteStructure)
  fs.writeFileSync(path.join(outputDir, 'index.html'), indexHtmlContent)
  console.log('\n✅ All done! Your Study Hub is complete.')
}

// --- HELPER FUNCTIONS (generateIndexHtml and slugify are slightly updated) ---

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

function generateIndexHtml(structure) {
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

  const activeFiles = allFiles.filter(file => now - file.modifiedTime < activeThreshold).sort((a, b) => b.modifiedTime - a.modifiedTime)

  let activeFilesHtml = ''
  if (activeFiles.length > 0) {
    activeFilesHtml += `<div class="active-files-group" data-directory-name="nedávno aktualizované"><h2>Nedávno aktualizované</h2><ul>`
    activeFiles.forEach(file => {
      activeFilesHtml += `
            <li data-file-name="${file.originalName.toLowerCase()}" data-directory-name="${file.directoryName.toLowerCase()}">
                <a href="./${file.htmlName}">
                    ${file.originalName}
                    <span class="file-group-name">(${file.directoryName})</span>
                </a>
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
      const badge = isRecent ? ' <span class="badge">NOVÉ</span>' : ''
      fileListHtml += `<li data-file-name="${file.originalName.toLowerCase()}"><a href="./${file.htmlName}">${
        file.originalName
      }</a>${badge}</li>`
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
        <input type="text" id="searchInput" placeholder="Hledat v poznámkách...">
        ${activeFilesHtml}
        <div id="file-list">${fileListHtml}</div>
    </div>
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
