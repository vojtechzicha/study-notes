#!/bin/bash

# ==============================================================================
# SCRIPT: create_from_template.sh
# DESCRIPTION: Copies a template file and renames the copies based on filenames
#              from another source directory.
# ==============================================================================

# --- Configuration ---
# IMPORTANT: Please update these paths to match your folder locations.
# To get the full path, right-click a folder in Finder, hold the Option (⌥) key,
# and select "Copy 'FolderName' as Pathname".

# Path to the folder containing the DOCX files you want to use for naming.
# Example: "/Users/vojtech/Documents/University TUL Bachelor"
SOURCE_DIR="/Users/vojtechzicha/OneDrive/Documents/University TUL Bachelor"

# Path to the folder containing your "template.docx" and where the new files will be created.
# Example: "/Users/vojtech/Documents/transfer"
DEST_DIR="/Users/vojtechzicha/transfer"

# The name of your template file.
TEMPLATE_NAME="template.docx"
# --- End of Configuration ---

# --- Script Logic (No need to edit below this line) ---

# Construct the full path to the template file
TEMPLATE_PATH="$DEST_DIR/$TEMPLATE_NAME"

# 1. --- Initial Checks ---
# Check if the template file actually exists before starting
if [ ! -f "$TEMPLATE_PATH" ]; then
    echo "Error: Template file not found at '$TEMPLATE_PATH'"
    echo "Please check your DEST_DIR and TEMPLATE_NAME configuration."
    exit 1
fi

# Check if the source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: Source directory not found at '$SOURCE_DIR'"
    echo "Please check your SOURCE_DIR configuration."
    exit 1
fi

echo "Template found: $TEMPLATE_PATH"
echo "Source directory found: $SOURCE_DIR"
echo "Starting to create copies..."
echo "------------------------------------"

# 2. --- Main Loop ---
# This loop safely finds all .docx files in the source directory,
# even those with spaces or special characters in their names.
#
# -print0 and -d '' handle filenames safely.
# `find` is used to get all .docx files, ignoring folders inside.
find "$SOURCE_DIR" -type f -name "*.docx" -print0 | while IFS= read -r -d '' source_file_path; do
    # Get just the filename from the full path (e.g., "MA1 Makroekonomie I.docx")
    filename=$(basename "$source_file_path")

    # Define the full path for the new file in the destination directory
    new_file_path="$DEST_DIR/$filename"

    # Copy the template to the new file path.
    # -n: (no-clobber) does not overwrite an existing file. This is a safety measure.
    # -v: (verbose) prints a message for each file copied.
    cp -nv "$TEMPLATE_PATH" "$new_file_path"
done

echo "------------------------------------"
echo "✅ Script finished."
echo "New files have been created in '$DEST_DIR'."
