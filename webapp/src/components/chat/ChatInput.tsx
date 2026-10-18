import { useRef, useState, type KeyboardEvent } from "react";
import { MAX_CHAT_IMAGES, MAX_CHAT_IMAGE_BYTES } from "shared";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import { Alert, Box, Stack, Tooltip, IconButton, InputAdornment, Paper, TextField } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import StopRounded from "@mui/icons-material/StopRounded";

type ChatInputProps = {
  images: string[];
  onImagesChange: (images: string[]) => void;
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

  async function addImages(files: File[]) {
    if (disabled || loading || reading || !files.length) return;
    setImageError(null);
    if (images.length + files.length > MAX_CHAT_IMAGES) {
      setImageError(`Attach up to ${MAX_CHAT_IMAGES} images.`);
      return;
    }
    if (
      files.some(
        (file) => !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > MAX_CHAT_IMAGE_BYTES,
      )
    ) {
      setImageError("Use PNG, JPEG, WebP or GIF images up to 5 MB each.");
      return;
    }
    setReading(true);
    try {
      const added = await Promise.all(
        files.map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(new Error("Could not read image."));
              reader.onabort = () => reject(new Error("Could not read image."));
              reader.readAsDataURL(file);
            }),
        ),
      );
      onImagesChange([...images, ...added]);
    } catch {
      setImageError("Could not read image. Try again.");
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
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          void addImages(Array.from(e.target.files ?? []));
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
            void addImages(files);
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
                <Tooltip title="Upload images">
                  <span>
                    <IconButton
                      size="small"
                      aria-label="Upload images"
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
                {stoppable && !value.trim() && !images.length ? (
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
