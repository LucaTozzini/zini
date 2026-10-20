import { useRef, useState, type KeyboardEvent } from "react";
import { MAX_CHAT_FILES, MAX_CHAT_FILE_BYTES, MAX_CHAT_IMAGES, MAX_CHAT_IMAGE_BYTES, type ChatFile } from "shared";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import { Alert, Box, Chip, Stack, Tooltip, IconButton, InputAdornment, Paper, TextField } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import StopRounded from "@mui/icons-material/StopRounded";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
// Browsers often give text files no type, or a wrong one (.ts as video), so these go by
// their extension.
const TEXT_EXTENSIONS = /\.(md|markdown|txt|csv|tsv|json|ya?ml|xml|html?|css|js|jsx|ts|tsx|py|rb|go|rs|java|sh|sql|log)$/i;

// The type a file is sent as, or null if it can't be attached: PDFs and text files.
function fileType(file: File) {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "application/pdf";
  if (/\.(md|markdown)$/i.test(file.name)) return "text/markdown";
  if (TEXT_EXTENSIONS.test(file.name)) return file.type.startsWith("text/") ? file.type : "text/plain";
  if (file.type.startsWith("text/") || file.type === "application/json") return file.type;
  return null;
}

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onabort = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });

type ChatInputProps = {
  images: string[];
  onImagesChange: (images: string[]) => void;
  // PDFs and text files, where the chat takes them.
  files?: ChatFile[];
  onFilesChange?: (files: ChatFile[]) => void;
  disabled: boolean;
  loading: boolean;
  canSend: boolean;
  // A run is going on that can be stopped: while nothing is typed, the send button
  // stops it instead.
  stoppable: boolean;
  onStop: () => void;
  placeholder: string;
  value: string;
  handleKeyDown: (e: KeyboardEvent<Element>) => void;
  onChange: (x: string) => void;
  onSubmit: () => void;
};

const ChatInput = ({
  images,
  onImagesChange,
  files = [],
  onFilesChange,
  disabled,
  loading,
  canSend,
  stoppable,
  onStop,
  placeholder,
  value,
  onChange,
  handleKeyDown,
  onSubmit,
}: ChatInputProps) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function addAttachments(picked: File[]) {
    if (disabled || loading || reading || !picked.length) return;
    setImageError(null);
    const newImages = picked.filter((file) => IMAGE_TYPES.includes(file.type));
    const newFiles = onFilesChange ? picked.filter((file) => !IMAGE_TYPES.includes(file.type)) : [];
    if (images.length + newImages.length > MAX_CHAT_IMAGES) {
      setImageError(`Attach up to ${MAX_CHAT_IMAGES} images.`);
      return;
    }
    if (files.length + newFiles.length > MAX_CHAT_FILES) {
      setImageError(`Attach up to ${MAX_CHAT_FILES} files.`);
      return;
    }
    if (newImages.length + newFiles.length < picked.length || newImages.some((file) => file.size > MAX_CHAT_IMAGE_BYTES)) {
      setImageError("Use PNG, JPEG, WebP or GIF images up to 5 MB each.");
      return;
    }
    if (newFiles.some((file) => !fileType(file) || file.size > MAX_CHAT_FILE_BYTES)) {
      setImageError("Attach images, or PDF and text files up to 10 MB each.");
      return;
    }
    setReading(true);
    try {
      const [addedImages, addedFiles] = await Promise.all([
        Promise.all(newImages.map(readDataUrl)),
        Promise.all(
          newFiles.map(async (file) => {
            const data = await readDataUrl(file);
            // Sent as its type from fileType, not the browser's guess.
            return { name: file.name, data: `data:${fileType(file)};base64,${data.slice(data.indexOf(",") + 1)}` };
          }),
        ),
      ]);
      if (addedImages.length) onImagesChange([...images, ...addedImages]);
      if (addedFiles.length) onFilesChange?.([...files, ...addedFiles]);
    } catch {
      setImageError("Could not read the file. Try again.");
    } finally {
      setReading(false);
    }
  }

  return (
    <Paper sx={{ borderRadius: 2 }} variant="outlined">
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept={onFilesChange ? undefined : IMAGE_TYPES.join(",")}
        onChange={(e) => {
          void addAttachments(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {imageError && (
        <Alert severity="error" onClose={() => setImageError(null)}>
          {imageError}
        </Alert>
      )}
      {images.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ p: 1, overflowX: "auto" }}>
          {images.map((src, i) => (
            <Box key={i} sx={{ position: "relative", flexShrink: 0 }}>
              <Box
                component="img"
                src={src}
                alt={`Attached image ${i + 1}`}
                sx={{ width: 80, height: 80, objectFit: "cover", borderRadius: 1 }}
              />
              <IconButton
                size="small"
                aria-label={`Remove image ${i + 1}`}
                disabled={disabled || loading || reading}
                onClick={() => onImagesChange(images.filter((_, index) => index !== i))}
                sx={{ position: "absolute", top: 0, right: 0, bgcolor: "background.paper" }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Stack>
      )}
      {files.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ p: 1, overflowX: "auto" }}>
          {files.map((file, i) => (
            <Chip
              key={i}
              label={file.name}
              disabled={disabled || loading || reading}
              onDelete={() => onFilesChange?.(files.filter((_, index) => index !== i))}
            />
          ))}
        </Stack>
      )}
      <TextField
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reading) onSubmit();
        }}
        fullWidth
        variant="outlined"
        multiline
        maxRows={8}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (reading && e.key === "Enter" && !e.shiftKey) e.preventDefault();
          else handleKeyDown(e);
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.items)
            .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
            .flatMap((item) => {
              const file = item.getAsFile();
              return file ? [file] : [];
            });
          if (files.length) {
            if (!e.clipboardData.getData("text/plain")) e.preventDefault();
            void addAttachments(files);
          }
        }}
        disabled={disabled}
        sx={{
          "& .MuiOutlinedInput-root": {
            "& fieldset": {
              border: "none", // Removes the default border
            },
            "&:hover fieldset": {
              border: "none", // Removes border on hover,
            },
            "&.Mui-focused fieldset": {
              border: "none", // Removes border when focused
            },
          },
        }}
        slotProps={{
          input: {
            sx: {
              display: "flex",
            },
            startAdornment: (
              <InputAdornment position="start" sx={{ alignSelf: "flex-end" }}>
                <Tooltip title={onFilesChange ? "Attach images or files" : "Upload images"}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={onFilesChange ? "Attach images or files" : "Upload images"}
                      disabled={disabled || loading || reading}
                      onClick={() => fileInput.current?.click()}
                    >
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end" sx={{ alignSelf: "flex-end" }}>
                {/* While the agent works and nothing is typed, the button stops the run:
                the square, in the send button's place, rather than a second control
                beside it. With a message typed, it sends it, which steers the agent. */}
                {stoppable && !value.trim() && !images.length && !files.length ? (
                  <IconButton
                    size="small"
                    type="button"
                    aria-label="Stop"
                    onClick={onStop}
                    disabled={disabled}
                    sx={{
                      background: (theme) => (theme.vars || theme).palette.primary.main,
                      ":hover": {
                        background: (theme) => (theme.vars || theme).palette.primary.light,
                      },
                      color: "primary.contrastText",
                    }}
                  >
                    <StopRounded fontSize="small" />
                  </IconButton>
                ) : (
                  <IconButton
                    size="small"
                    type="submit"
                    loading={loading}
                    disabled={!canSend || reading}
                    sx={{
                      background: (theme) => (theme.vars || theme).palette.primary.main,
                      ":hover": {
                        background: (theme) => (theme.vars || theme).palette.primary.light,
                      },
                      color: "primary.contrastText",
                    }}
                  >
                    <ArrowUpwardIcon fontSize="small" />
                  </IconButton>
                )}
              </InputAdornment>
            ),
          },
        }}
      />
    </Paper>
  );
};

export default ChatInput;
