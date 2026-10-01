import type { KeyboardEvent } from "react";
import { IconButton, InputAdornment, Paper, TextField } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import StopRounded from "@mui/icons-material/StopRounded";

type ChatInputProps = {
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
  return (
    <Paper sx={{borderRadius: 8}}>

      <TextField
        component="form"
        onSubmit={onSubmit}
        fullWidth
        variant="outlined"
        multiline
        maxRows={8}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
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
              borderRadius: 8,
              display: "flex",
            },
            endAdornment: (
              <InputAdornment position="end" sx={{ alignSelf: "flex-end" }}>
                {/* While the agent works and nothing is typed, the button stops the run:
                the square, in the send button's place, rather than a second control
                beside it. With a message typed, it sends it, which steers the agent. */}
                {stoppable && !value.trim() ? (
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
                      color: "primary.contrastText"
                    }}
                  >
                    <StopRounded fontSize="small" />
                  </IconButton>
                ) : (
                  <IconButton
                    size="small"
                    type="submit"
                    loading={loading}
                    disabled={!canSend}
                    sx={{
                      background: (theme) => (theme.vars || theme).palette.primary.main,
                      ":hover": {
                        background: (theme) => (theme.vars || theme).palette.primary.light,
                      },
                      color: "primary.contrastText"
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
