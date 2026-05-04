import { pool } from "../config/db.js";

export async function getPreference(req, res) {
  try {
    const { userId, key } = req.params;

    const result = await pool.query(
      `
      SELECT preference_value
      FROM user_preferences
      WHERE user_id = $1 AND preference_key = $2
      LIMIT 1
      `,
      [userId, key]
    );

    res.json({
      ok: true,
      value: result.rows[0]?.preference_value || null,
    });
  } catch (error) {
    console.error("Error obteniendo preferencia:", error);
    res.status(500).json({
      ok: false,
      error: "Error obteniendo preferencia",
      detail: error.message,
    });
  }
}

export async function savePreference(req, res) {
  try {
    const { userId, key } = req.params;
    const value = req.body || {};

    const result = await pool.query(
      `
      INSERT INTO user_preferences (
        user_id,
        preference_key,
        preference_value,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (user_id, preference_key)
      DO UPDATE SET
        preference_value = EXCLUDED.preference_value,
        updated_at = NOW()
      RETURNING *
      `,
      [userId, key, value]
    );

    res.json({
      ok: true,
      preference: result.rows[0],
    });
  } catch (error) {
    console.error("Error guardando preferencia:", error);
    res.status(500).json({
      ok: false,
      error: "Error guardando preferencia",
      detail: error.message,
    });
  }
}

export async function deletePreference(req, res) {
  try {
    const { userId, key } = req.params;

    await pool.query(
      `
      DELETE FROM user_preferences
      WHERE user_id = $1 AND preference_key = $2
      `,
      [userId, key]
    );

    res.json({
      ok: true,
      deleted: true,
    });
  } catch (error) {
    console.error("Error eliminando preferencia:", error);
    res.status(500).json({
      ok: false,
      error: "Error eliminando preferencia",
      detail: error.message,
    });
  }
}