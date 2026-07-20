use std::error::Error;
use std::fmt;

pub type BoxError = Box<dyn Error + Send + Sync + 'static>;
pub type Result<T> = std::result::Result<T, BoxError>;

pub fn message(message: impl Into<String>) -> BoxError {
    Box::new(MessageError(message.into()))
}

pub fn context<E>(message: impl Into<String>, source: E) -> BoxError
where
    E: Error + Send + Sync + 'static,
{
    Box::new(ContextError {
        message: message.into(),
        source: Box::new(source),
    })
}

struct MessageError(String);

impl fmt::Display for MessageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl fmt::Debug for MessageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, formatter)
    }
}

impl Error for MessageError {}

struct ContextError {
    message: String,
    source: BoxError,
}

impl fmt::Display for ContextError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl fmt::Debug for ContextError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.message, self.source)
    }
}

impl Error for ContextError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        Some(self.source.as_ref())
    }
}
