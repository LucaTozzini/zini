import type { KeyboardEvent } from "react";
import { IconButton, InputAdornment, TextField } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";

type ChatInputProps = {
  disabled: boolean;
  loading: boolean;
  canSend: boolean;
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
  placeholder,
  value,
  onChange,
  handleKeyDown,
  onSubmit,
}: ChatInputProps) => {
  return (
    
      
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
              bgcolor: "background.paper",
              display: "flex",
              boxShadow: 5,
            },
            endAdornment: (
              <InputAdornment position="end" sx={{ alignSelf: "flex-end" }}>
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
              </InputAdornment>
            ),
          },
        }}
      />
  );
};

export default ChatInput;
